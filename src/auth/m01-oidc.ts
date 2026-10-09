export type M01Config =
  | { authMode: 'local-dev' }
  | {
    authMode: 'm01';
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    audience: string;
  };

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required when AEOS_AUTH_MODE is m01`);
  }
  return value.trim();
}

function validUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

export function readM01Config(environment: NodeJS.ProcessEnv = process.env): M01Config {
  if (environment.AEOS_AUTH_MODE !== 'm01') return { authMode: 'local-dev' };

  const issuer = requiredEnvironmentValue(environment, 'M01_ISSUER');
  const clientId = requiredEnvironmentValue(environment, 'M01_CLIENT_ID');
  const clientSecret = requiredEnvironmentValue(environment, 'M01_CLIENT_SECRET');
  const redirectUri = requiredEnvironmentValue(environment, 'M01_REDIRECT_URI');
  const audience = requiredEnvironmentValue(environment, 'M01_AUDIENCE');
  const issuerUrl = validUrl(issuer, 'M01_ISSUER');
  validUrl(redirectUri, 'M01_REDIRECT_URI');
  if (issuerUrl.protocol !== 'https:') {
    throw new Error('M01_ISSUER must use https');
  }

  return { authMode: 'm01', issuer, clientId, clientSecret, redirectUri, audience };
}
