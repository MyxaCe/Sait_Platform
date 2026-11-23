/**
 * Подсказка «клиент вошёл в кабинет» для витрины.
 *
 * Сессия кабинета (`cabinet_session`) — httpOnly-cookie только на домене кабинета, витрина её не видит
 * и видеть не должна. Поэтому кабинет при входе ставит на общий родительский домен отдельный флажок
 * без секретов: значение всегда `1`, ни токена, ни имени, ни id. Витрина читает его в браузере и
 * показывает «Кабинет» вместо «Войти / Открыть счёт».
 *
 * Флажок — только подсказка. Если он устарел (сессия истекла), ссылка всё равно ведёт в кабинет,
 * а кабинет отправит на вход и снимет флажок.
 */
export const SESSION_HINT_COOKIE = 'cab_session_hint';
export const SESSION_HINT_VALUE = '1';

/** Домен флажка: явный `SESSION_HINT_COOKIE_DOMAIN`, иначе тот же общий домен, что у языка и атрибуции. */
export function sessionHintDomain(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const raw of [env.SESSION_HINT_COOKIE_DOMAIN, env.LOCALE_COOKIE_DOMAIN, env.ATTRIBUTION_COOKIE_DOMAIN]) {
    const value = raw?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Читает флажок из строки `document.cookie`. */
export function hasSessionHint(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(';')
    .some((part) => part.trim() === `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}`);
}
