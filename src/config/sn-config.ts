import { z } from 'zod';

const instanceUrl = z.string().min(1, 'instanceUrl is required');
const clientId = z.string().min(1, 'clientId is required');
const clientSecret = z.string().min(1, 'clientSecret is required');
const username = z.string().min(1, 'username is required');
const password = z.string().min(1, 'password is required');

const basicSchema = z.object({
  authType: z.literal('basic'),
  instanceUrl,
  username,
  password,
});

const oAuthPasswordSchema = z.object({
  authType: z.literal('oauth'),
  grantType: z.literal('password'),
  instanceUrl,
  clientId,
  clientSecret,
  username,
  password,
});

const oAuthClientCredentialsSchema = z.object({
  authType: z.literal('oauth'),
  grantType: z.literal('client_credentials'),
  instanceUrl,
  clientId,
  clientSecret,
});

/**
 * Single source of truth for how ServiceNow is authenticated.
 */
export const serviceNowConfigSchema = z.union([
  basicSchema,
  oAuthPasswordSchema,
  oAuthClientCredentialsSchema,
]);

export type BasicAuthConfig = z.infer<typeof basicSchema>;
export type OAuthConfig =
  | z.infer<typeof oAuthPasswordSchema>
  | z.infer<typeof oAuthClientCredentialsSchema>;
export type ServiceNowConfig = z.infer<typeof serviceNowConfigSchema>;

/** Flatten a ZodError into a single human-readable line. */
export function formatConfigError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
