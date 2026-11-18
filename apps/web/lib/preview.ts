export function requestOrigin(headers: Headers, fallbackOrigin: string): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return fallbackOrigin;
  const proto = headers.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

export function sanitizeRedirectPath(path: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return '/';
  }
  return path;
}
