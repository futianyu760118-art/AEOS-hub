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

function assertNoUrlCredentialsQueryOrHash(url: URL, value: string, name: string): void {
  if (url.username || url.password || value.includes('?') || value.includes('#')) {
    throw new Error(`${name} must not include credentials, query, or hash`);
  }
}

function readAuthMode(environment: NodeJS.ProcessEnv): 'local-dev' | 'm01' {
  const authMode = environment.AEOS_AUTH_MODE;
  if (authMode === undefined || authMode === 'local-dev' || authMode === 'm01') {
    return authMode === 'm01' ? 'm01' : 'local-dev';
  }
  throw new Error('AEOS_AUTH_MODE must be unset, local-dev, or m01');
}

function validateIssuer(issuer: string): void {
  const url = validUrl(issuer, 'M01_ISSUER');
  assertNoUrlCredentialsQueryOrHash(url, issuer, 'M01_ISSUER');
  if (url.protocol !== 'https:' || !url.host) {
    throw new Error('M01_ISSUER must be an HTTPS URL with a host');
  }
}

function validateRedirectUri(redirectUri: string): void {
  const url = validUrl(redirectUri, 'M01_REDIRECT_URI');
  assertNoUrlCredentialsQueryOrHash(url, redirectUri, 'M01_REDIRECT_URI');
  if (!url.host) {
    throw new Error('M01_REDIRECT_URI must include a host');
  }
  if (url.protocol === 'https:') return;

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new Error('M01_REDIRECT_URI must use HTTPS or loopback HTTP');
  }
}

export function readM01Config(environment: NodeJS.ProcessEnv = process.env): M01Config {
  if (readAuthMode(environment) !== 'm01') return { authMode: 'local-dev' };

  const issuer = requiredEnvironmentValue(environment, 'M01_ISSUER');
  const clientId = requiredEnvironmentValue(environment, 'M01_CLIENT_ID');
  const clientSecret = requiredEnvironmentValue(environment, 'M01_CLIENT_SECRET');
  const redirectUri = requiredEnvironmentValue(environment, 'M01_REDIRECT_URI');
  const audience = requiredEnvironmentValue(environment, 'M01_AUDIENCE');
  validateIssuer(issuer);
  validateRedirectUri(redirectUri);

  return { authMode: 'm01', issuer, clientId, clientSecret, redirectUri, audience };
}
