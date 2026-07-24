/**
 * Preview-режим (этап 3, риск R-09): редактор CMS открывает
 * /api/preview?secret=…&path=/promotions и видит черновой контент.
 */

/** Разрешаем только внутренние пути — защита от open redirect. */
export function sanitizeRedirectPath(path: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return '/';
  }
  return path;
}
