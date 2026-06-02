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

const snCredsPresent = !!(
  process.env.SN_INSTANCE &&
  process.env.SN_USERNAME &&
  process.env.SN_PASSWORD
);
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
  },

  credentialProvider: rawProvider as CredentialProviderType,
  gatewaySecret: optional('GATEWAY_SECRET', ''),
};
