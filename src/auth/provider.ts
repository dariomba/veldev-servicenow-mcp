import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  formatConfigError,
  type ServiceNowConfig,
  serviceNowConfigSchema,
} from '../config/sn-config.js';
import { log } from '../logger.js';

export type CredentialResult =
  | { ok: true; credentials: ServiceNowConfig }
  | { ok: false; status: number; error: string };

export interface CredentialProvider {
  resolve(req: IncomingMessage): Promise<CredentialResult>;
}

export class EnvCredentialProvider implements CredentialProvider {
  constructor(private readonly credentials: ServiceNowConfig) {}

  async resolve(_req: IncomingMessage): Promise<CredentialResult> {
    log('DBG', 'DEV MODE — using env credentials');
    return { ok: true, credentials: this.credentials };
  }
}

function secretsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// NOTE: A future Bearer-token mode (X-SN-Token) is deferred — it needs
// ServiceNowClient to support token auth, out of scope here.
export class HeaderCredentialProvider implements CredentialProvider {
  constructor(private readonly gatewaySecret: string) {}

  async resolve(req: IncomingMessage): Promise<CredentialResult> {
    const providedSecret = req.headers['x-gateway-secret'] as
      | string
      | undefined;

    if (!secretsMatch(this.gatewaySecret, providedSecret ?? '')) {
      return {
        ok: false,
        status: 401,
        error: 'missing or invalid gateway secret',
      };
    }

    const result = serviceNowConfigSchema.safeParse({
      authType: req.headers['x-sn-auth-type'] ?? 'basic',
      grantType: req.headers['x-sn-grant-type'] ?? 'password',
      instanceUrl: req.headers['x-sn-instance'],
      clientId: req.headers['x-sn-client-id'],
      clientSecret: req.headers['x-sn-client-secret'],
      username: req.headers['x-sn-username'],
      password: req.headers['x-sn-password'],
    });

    if (!result.success) {
      return {
        ok: false,
        status: 400,
        error: `invalid ServiceNow credential headers: ${formatConfigError(result.error)}`,
      };
    }

    return { ok: true, credentials: result.data };
  }
}
