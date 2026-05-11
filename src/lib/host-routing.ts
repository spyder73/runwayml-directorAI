function stripDefaultPort(host: string) {
  return host.replace(/:(80|443)$/, '');
}

export function normalizeHost(host: string | null | undefined) {
  const firstHost = (host || '').split(',')[0]?.trim().toLowerCase() || '';
  if (!firstHost) return '';
  if (firstHost.startsWith('[')) return firstHost;
  return stripDefaultPort(firstHost);
}

export function appPublicUrl() {
  const configured = process.env.APP_URL?.trim() || 'http://localhost:3000';

  try {
    const url = new URL(configured);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}

function isLocalHost(host: string) {
  const normalized = normalizeHost(host).replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(normalized);
}

export function isStudioHost(host: string | null | undefined) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return true;
  if (isLocalHost(normalizedHost)) return true;

  const configuredHost = normalizeHost(new URL(appPublicUrl()).host);
  return normalizedHost === configuredHost;
}
