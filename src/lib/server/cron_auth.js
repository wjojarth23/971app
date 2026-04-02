export function getCronSecrets(envLike = {}) {
  return Array.from(new Set([
    envLike?.NOTIFICATION_CRON_TOKEN,
    envLike?.CRON_NOTIFICATION_TOKEN,
    envLike?.CRON_SECRET
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function getAuthorizationHeader(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return String(headers.get('authorization') || '').trim();
  }
  return String(headers.authorization || headers.Authorization || '').trim();
}

function getBearerToken(headers) {
  const authorization = getAuthorizationHeader(headers);
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match ? match[1].trim() : '';
}

export function isAuthorizedCronRequest({ url, headers, env: envLike = {} }) {
  const expectedSecrets = getCronSecrets(envLike);
  if (!expectedSecrets.length) return true;

  const queryToken = String(url?.searchParams?.get('token') || '').trim();
  if (queryToken && expectedSecrets.includes(queryToken)) return true;

  const bearerToken = getBearerToken(headers);
  if (bearerToken && expectedSecrets.includes(bearerToken)) return true;

  return false;
}
