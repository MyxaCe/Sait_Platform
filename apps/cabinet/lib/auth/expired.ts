import { withNext } from './next-path';

/**
 * Куда вести клиента, у которого cookie сессии есть, а сама сессия погашена (выход на другом
 * устройстве, блокировка, истёк срок). Прямо на /login нельзя: middleware видит cookie и
 * возвращает на главную — получается петля / ↔ /login (ТД-009 п.4). Cookie в серверном
 * компоненте не стереть, поэтому идём через обработчик, который стирает её и ведёт на вход.
 */
export const EXPIRED_PATH = '/api/auth/expired';

export function expiredHref(locale: string, next: string | null = null): string {
  const query = new URLSearchParams({ locale });
  if (next) query.set('next', next);
  return `${EXPIRED_PATH}?${query.toString()}`;
}

export function loginAfterExpiry(loginPath: string, next: string | null): string {
  return withNext(loginPath, next);
}
