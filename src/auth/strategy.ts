import { fetchWithTimeout, SnApiError } from '../clients/http.js';
import type {
  BasicAuthConfig,
  OAuthConfig,
  ServiceNowConfig,
} from '../config/sn-config.js';
import { log } from '../logger.js';

/**
 * Encapsulates how a request is authenticated against ServiceNow.
 * The client stays agnostic to whether that is Basic auth or OAuth.
 */
export interface AuthStrategy {
  /** Authorization header value to send with each request. */
  authHeader(): Promise<string>;
  /**
   * Called after a 401. Returns true if the failure may be transient and the
   * request is worth retrying (e.g. an expired OAuth token was discarded),
   * false if the credentials are simply wrong (Basic auth).
   */
  onUnauthorized(): boolean;
  /** Authenticated username, or '' when not tied to a user (client_credentials). */
  username(): string;
}

class BasicAuthStrategy implements AuthStrategy {
  private readonly header: string;

  constructor(private readonly config: BasicAuthConfig) {
    this.header = `Basic ${Buffer.from(
      `${config.username}:${config.password}`,
    ).toString('base64')}`;
  }

  async authHeader(): Promise<string> {
    return this.header;
  }

  onUnauthorized(): boolean {
    return false;
  }

  username(): string {
    return this.config.username;
  }
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

const TOKEN_ENDPOINT = '/oauth_token.do';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TTL_SECONDS = 1800;
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

type OAuthGrant = OAuthConfig['grantType'] | 'refresh_token';

class OAuthStrategy implements AuthStrategy {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly config: OAuthConfig,
  ) {}

  async authHeader(): Promise<string> {
    return `Bearer ${await this.resolveToken()}`;
  }

  onUnauthorized(): boolean {
    this.accessToken = null;
    this.expiresAt = 0;
    return true;
  }

  username(): string {
    return this.config.grantType === 'password' ? this.config.username : '';
  }

  private async resolveToken(): Promise<string> {
    if (
      this.accessToken &&
      Date.now() < this.expiresAt - TOKEN_EXPIRY_SKEW_MS
    ) {
      return this.accessToken;
    }
    if (!this.inFlight) {
      this.inFlight = this.acquireToken().finally(() => {
        this.inFlight = null;
      });
    }
    await this.inFlight;
    return this.accessToken as string;
  }

  private async acquireToken(): Promise<void> {
    if (this.refreshToken) {
      try {
        await this.fetchToken('refresh_token');
        return;
      } catch (err) {
        log('DBG', 'OAuth token refresh failed, falling back to full grant', {
          error: String(err),
        });
      }
    }
    await this.fetchToken(this.config.grantType);
  }

  private async fetchToken(grant: OAuthGrant): Promise<void> {
    const params = new URLSearchParams({
      grant_type: grant,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    if (grant === 'refresh_token') {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }
      params.set('refresh_token', this.refreshToken);
    } else if (this.config.grantType === 'password') {
      params.set('username', this.config.username);
      params.set('password', this.config.password);
    }

    const url = `${this.baseUrl}${TOKEN_ENDPOINT}`;
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      },
      TOKEN_REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new SnApiError(
        response.status,
        response.statusText,
        await response.text(),
        url,
      );
    }

    const data = (await response.json()) as OAuthTokenResponse;
    this.accessToken = data.access_token;
    // ServiceNow may omit a fresh refresh_token on refresh; keep the existing one.
    this.refreshToken = data.refresh_token ?? this.refreshToken;
    this.expiresAt =
      Date.now() + (data.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000;
  }
}

export function createAuthStrategy(
  config: ServiceNowConfig,
  baseUrl: string,
): AuthStrategy {
  return config.authType === 'basic'
    ? new BasicAuthStrategy(config)
    : new OAuthStrategy(baseUrl, config);
}
