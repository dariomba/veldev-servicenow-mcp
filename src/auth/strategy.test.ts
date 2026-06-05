import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasicAuthConfig, OAuthConfig } from '../config/sn-config.js';
import { createAuthStrategy } from './strategy.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE_URL = 'https://dev99999.service-now.com';

const BASIC: BasicAuthConfig = {
  authType: 'basic',
  instanceUrl: BASE_URL,
  username: 'admin',
  password: 'secret',
};

const OAUTH_PASSWORD: OAuthConfig = {
  authType: 'oauth',
  grantType: 'password',
  instanceUrl: BASE_URL,
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'admin',
  password: 'secret',
};

const OAUTH_CLIENT_CREDS: OAuthConfig = {
  authType: 'oauth',
  grantType: 'client_credentials',
  instanceUrl: BASE_URL,
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Unauthorized',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Parse the form body that was POSTed on the Nth fetch call. */
function tokenRequest(call = 0): URLSearchParams {
  return new URLSearchParams(mockFetch.mock.calls[call][1].body as string);
}

describe('createAuthStrategy', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(() => vi.clearAllMocks());

  describe('basic auth', () => {
    const strategy = createAuthStrategy(BASIC, BASE_URL);

    it('returns a static Basic header without any network call', async () => {
      const header = await strategy.authHeader();
      const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
      expect(header).toBe(expected);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not request a retry on 401', () => {
      expect(strategy.onUnauthorized()).toBe(false);
    });

    it('exposes the configured username', () => {
      expect(strategy.username()).toBe('admin');
    });
  });

  describe('oauth password grant', () => {
    it('fetches a token and returns a Bearer header', async () => {
      mockFetch.mockResolvedValueOnce(
        tokenResponse({ access_token: 'tok-1', expires_in: 1800 }),
      );
      const strategy = createAuthStrategy(OAUTH_PASSWORD, BASE_URL);

      expect(await strategy.authHeader()).toBe('Bearer tok-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(`${BASE_URL}/oauth_token.do`);

      const body = tokenRequest();
      expect(body.get('grant_type')).toBe('password');
      expect(body.get('client_id')).toBe('client-id');
      expect(body.get('username')).toBe('admin');
      expect(body.get('password')).toBe('secret');
    });

    it('caches the token across calls', async () => {
      mockFetch.mockResolvedValueOnce(
        tokenResponse({ access_token: 'tok-1', expires_in: 1800 }),
      );
      const strategy = createAuthStrategy(OAUTH_PASSWORD, BASE_URL);

      await strategy.authHeader();
      await strategy.authHeader();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('shares a single token fetch across concurrent callers', async () => {
      mockFetch.mockResolvedValueOnce(
        tokenResponse({ access_token: 'tok-1', expires_in: 1800 }),
      );
      const strategy = createAuthStrategy(OAUTH_PASSWORD, BASE_URL);

      const [a, b] = await Promise.all([
        strategy.authHeader(),
        strategy.authHeader(),
      ]);

      expect(a).toBe('Bearer tok-1');
      expect(b).toBe('Bearer tok-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('uses the refresh token after onUnauthorized', async () => {
      mockFetch
        .mockResolvedValueOnce(
          tokenResponse({
            access_token: 'tok-1',
            refresh_token: 'refresh-1',
            expires_in: 1800,
          }),
        )
        .mockResolvedValueOnce(
          tokenResponse({ access_token: 'tok-2', expires_in: 1800 }),
        );
      const strategy = createAuthStrategy(OAUTH_PASSWORD, BASE_URL);

      await strategy.authHeader();
      expect(strategy.onUnauthorized()).toBe(true);
      expect(await strategy.authHeader()).toBe('Bearer tok-2');

      const refreshBody = tokenRequest(1);
      expect(refreshBody.get('grant_type')).toBe('refresh_token');
      expect(refreshBody.get('refresh_token')).toBe('refresh-1');
    });

    it('falls back to a full grant when refresh fails', async () => {
      mockFetch
        .mockResolvedValueOnce(
          tokenResponse({
            access_token: 'tok-1',
            refresh_token: 'refresh-1',
            expires_in: 1800,
          }),
        )
        .mockResolvedValueOnce(tokenResponse({ error: 'bad' }, 401))
        .mockResolvedValueOnce(
          tokenResponse({ access_token: 'tok-3', expires_in: 1800 }),
        );
      const strategy = createAuthStrategy(OAUTH_PASSWORD, BASE_URL);

      await strategy.authHeader();
      strategy.onUnauthorized();
      expect(await strategy.authHeader()).toBe('Bearer tok-3');

      expect(tokenRequest(1).get('grant_type')).toBe('refresh_token');
      expect(tokenRequest(2).get('grant_type')).toBe('password');
    });
  });

  describe('oauth client_credentials grant', () => {
    it('sends client_credentials without user fields', async () => {
      mockFetch.mockResolvedValueOnce(
        tokenResponse({ access_token: 'tok-1', expires_in: 1800 }),
      );
      const strategy = createAuthStrategy(OAUTH_CLIENT_CREDS, BASE_URL);

      expect(await strategy.authHeader()).toBe('Bearer tok-1');
      const body = tokenRequest();
      expect(body.get('grant_type')).toBe('client_credentials');
      expect(body.has('username')).toBe(false);
      expect(body.has('password')).toBe(false);
    });

    it('reports an empty username (not tied to a user)', () => {
      const strategy = createAuthStrategy(OAUTH_CLIENT_CREDS, BASE_URL);
      expect(strategy.username()).toBe('');
    });
  });
});
