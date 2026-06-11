import { config as loadEnv } from 'dotenv';

loadEnv();

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function optionalInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    console.error(`[config] Invalid integer for ${name}: "${value}"`);
    process.exit(1);
  }
  return parsed;
}

export type CredentialProviderType = 'env' | 'header';

const environment = optional('ENVIRONMENT', 'development');
const transport = optional('TRANSPORT', 'http');
const isDev = environment === 'development';
const isStdio = transport === 'stdio';

// Enum validity (basic|oauth, password|client_credentials) is enforced by the
// ServiceNow config schema when credentials are actually built.
const snAuthType = optional('SN_AUTH_TYPE', 'basic');

const snCredsPresent =
  !!process.env.SN_INSTANCE &&
  (snAuthType === 'oauth'
    ? !!(process.env.SN_CLIENT_ID && process.env.SN_CLIENT_SECRET)
    : !!(process.env.SN_USERNAME && process.env.SN_PASSWORD));
const defaultProvider: CredentialProviderType =
  (isDev || isStdio) && snCredsPresent ? 'env' : 'header';

const rawProvider = optional('CREDENTIAL_PROVIDER', defaultProvider);
const validProviders: readonly CredentialProviderType[] = ['env', 'header'];
if (!validProviders.includes(rawProvider as CredentialProviderType)) {
  console.error(
    `[config] Invalid CREDENTIAL_PROVIDER "${rawProvider}". Must be one of: ${validProviders.join(', ')}`,
  );
  process.exit(1);
}

const snGrantType = optional('SN_GRANT_TYPE', 'password');

const rawEnforcement = optional('ACCESS_ENFORCEMENT', 'off');
if (rawEnforcement !== 'on' && rawEnforcement !== 'off') {
  console.error(
    `[config] Invalid ACCESS_ENFORCEMENT "${rawEnforcement}". Must be one of: on, off`,
  );
  process.exit(1);
}

export const config = {
  port: optionalInt('PORT', 3000),
  transport,
  environment,
  isDev,
  allowedOrigin: optional('ALLOWED_ORIGIN', isDev ? '*' : ''),

  sn: {
    instance: optional('SN_INSTANCE', ''),
    username: optional('SN_USERNAME', ''),
    password: optional('SN_PASSWORD', ''),
    authType: snAuthType as 'basic' | 'oauth',
    clientId: optional('SN_CLIENT_ID', ''),
    clientSecret: optional('SN_CLIENT_SECRET', ''),
    grantType: snGrantType as 'password' | 'client_credentials',
  },

  credentialProvider: rawProvider as CredentialProviderType,
  gatewaySecret: optional('GATEWAY_SECRET', ''),

  accessEnforcement: rawEnforcement as 'on' | 'off',
  // Node lowercases incoming header names; keep the lookup key consistent.
  accessHeader: optional('ACCESS_HEADER', 'x-mcp-access').toLowerCase(),
};
