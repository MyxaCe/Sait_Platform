/**
 * Preview-режим (этап 3, риск R-09): редактор CMS открывает
 * /api/preview?secret=…&path=/promotions и видит черновой контент.
 */

/** Разрешаем только внутренние пути — защита от open redirect. */
/**
 * Origin для редиректа глазами БРАУЗЕРА (B-015): в standalone-контейнере
 * request.url собирается от адреса, на котором слушает сервер (0.0.0.0),
 * а не от Host запроса — редирект на него браузер отвергает
 * (ERR_ADDRESS_INVALID). За прокси на VPS правду знают X-Forwarded-*.
 */
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
