import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { EnvCredentialProvider, HeaderCredentialProvider } from './provider.js';

const CREDS = {
  instanceUrl: 'https://dev12345.service-now.com',
  username: 'admin',
  password: 'secret',
};

function makeReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('EnvCredentialProvider', () => {
  it('always returns the configured credentials', async () => {
    const provider = new EnvCredentialProvider(CREDS);
    const result = await provider.resolve(makeReq());
    expect(result).toEqual({ ok: true, credentials: CREDS });
  });

  it('ignores request headers entirely', async () => {
    const provider = new EnvCredentialProvider(CREDS);
    const result = await provider.resolve(
      makeReq({ authorization: 'Bearer some-token' }),
    );
    expect(result).toEqual({ ok: true, credentials: CREDS });
  });
});

describe('HeaderCredentialProvider', () => {
  const SECRET = 'test-gateway-secret';

  it('returns credentials when secret and headers are valid', async () => {
    const provider = new HeaderCredentialProvider(SECRET);
    const result = await provider.resolve(
      makeReq({
        'x-gateway-secret': SECRET,
        'x-sn-instance': CREDS.instanceUrl,
        'x-sn-username': CREDS.username,
        'x-sn-password': CREDS.password,
      }),
    );
    expect(result).toEqual({ ok: true, credentials: CREDS });
  });

  it('rejects when gateway secret header is absent', async () => {
    const provider = new HeaderCredentialProvider(SECRET);
    const result = await provider.resolve(
      makeReq({
        'x-sn-instance': CREDS.instanceUrl,
        'x-sn-username': CREDS.username,
        'x-sn-password': CREDS.password,
      }),
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects when gateway secret is wrong', async () => {
    const provider = new HeaderCredentialProvider(SECRET);
    const result = await provider.resolve(
      makeReq({
        'x-gateway-secret': 'wrong-secret',
        'x-sn-instance': CREDS.instanceUrl,
        'x-sn-username': CREDS.username,
        'x-sn-password': CREDS.password,
      }),
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects when credential headers are missing', async () => {
    const provider = new HeaderCredentialProvider(SECRET);
    const result = await provider.resolve(
      makeReq({ 'x-gateway-secret': SECRET }),
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects when only some credential headers are present', async () => {
    const provider = new HeaderCredentialProvider(SECRET);
    const result = await provider.resolve(
      makeReq({
        'x-gateway-secret': SECRET,
        'x-sn-instance': CREDS.instanceUrl,
        // username and password missing
      }),
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
