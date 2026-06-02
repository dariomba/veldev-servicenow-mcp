import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ServiceNowConfig } from '../clients/servicenow.js';
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

    const instance = req.headers['x-sn-instance'] as string | undefined;
    const username = req.headers['x-sn-username'] as string | undefined;
    const password = req.headers['x-sn-password'] as string | undefined;

    if (!instance || !username || !password) {
      return {
        ok: false,
        status: 400,
        error: 'missing ServiceNow credential headers',
      };
    }

    return {
      ok: true,
      credentials: { instanceUrl: instance, username, password },
    };
  }
}
