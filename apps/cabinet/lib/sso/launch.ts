import type { AccountKind } from './jwt';

/**
 * Вход в терминал ВЕРХНИМ уровнем (контракт sso-pack v1.1, 10.11.2026):
 * `GET /api/sso/launch?account=…&return=<адрес терминала>[&lang=…]` →
 * `302 <return>#handoff=<jwt>&account=<kind>[&lang=…]`.
 *
 * Здесь — чистые правила, без сети и базы:
 *  - белый список origin'ов терминала (`TERMINAL_ORIGINS` через пробел/
 *    запятую; по умолчанию — origin `NEXT_PUBLIC_TERMINAL_URL`);
 *  - `return` принимается ТОЛЬКО при точном совпадении origin — никакого
 *    открытого редиректа (иначе кабинет подписывал бы токен входа и
 *    отправлял его на чужой адрес);
 *  - продолжение после логина — только на сам launch (внутренний путь).
 */

const LANGS = new Set(['ru', 'en']);

function originOf(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function terminalOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = (env.TERMINAL_ORIGINS ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const source = list.length > 0 ? list : env.NEXT_PUBLIC_TERMINAL_URL?.trim() ? [env.NEXT_PUBLIC_TERMINAL_URL] : [];
  const out = new Set<string>();
  for (const s of source) {
    const o = originOf(s);
    if (o) out.add(o);
  }
  return [...out];
}

/**
 * Проверенный адрес возврата (без фрагмента) или `null`. Сравнивается
 * origin целиком (схема + хост + порт); учётные данные в URL запрещены —
 * `https://user@terminal…` не принимаем, чтобы в адресе не жило ничего,
 * кроме терминала.
 */
export function checkReturnUrl(raw: string | null | undefined, origins: readonly string[]): string | null {
  if (!raw || origins.length === 0) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (!origins.includes(u.origin)) return null;
  u.hash = '';
  return u.toString();
}

export function parseLang(raw: string | null | undefined): 'ru' | 'en' | null {
  return raw && LANGS.has(raw) ? (raw as 'ru' | 'en') : null;
}

/** `<return>#handoff=<jwt>&account=<kind>[&lang=…]` — токен только во фрагменте. */
export function launchLocation(returnUrl: string, token: string, account: AccountKind, lang: 'ru' | 'en' | null): string {
  const frag = new URLSearchParams({ handoff: token, account });
  if (lang) frag.set('lang', lang);
  return `${returnUrl}#${frag.toString()}`;
}

export const LAUNCH_PATH = '/api/sso/launch';

/** Продолжение после логина: только сам launch (внутренний путь), иначе `null`. */
export function safeLaunchNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith(`${LAUNCH_PATH}?`)) return null;
  if (raw.includes('\\') || raw.startsWith('//')) return null;
  try {
    const u = new URL(raw, 'http://cabinet.invalid');
    return u.origin === 'http://cabinet.invalid' && u.pathname === LAUNCH_PATH ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

/** Новый путь включён флагом (`TERMINAL_TOP_LEVEL=1`) и есть адрес терминала. */
export function topLevelTerminalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERMINAL_TOP_LEVEL === '1' && !!env.NEXT_PUBLIC_TERMINAL_URL?.trim();
}

/**
 * Куда ведёт кнопка «Торговать на демо/реальном»: при включённом флаге —
 * launch верхним уровнем (`<terminal>/?site=<slug>`), иначе — `null`
 * (вызывающий рисует прежнюю полноэкранную `/terminal?account=…`).
 */
export function terminalLaunchHref(
  account: AccountKind,
  locale: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!topLevelTerminalEnabled(env)) return null;
  const site = env.SITE_SLUG?.trim();
  const base = env.NEXT_PUBLIC_TERMINAL_URL!.trim();
  if (!site) return null;
  let ret: URL;
  try {
    ret = new URL(base);
  } catch {
    return null;
  }
  if (ret.pathname === '') ret.pathname = '/';
  ret.search = '';
  ret.searchParams.set('site', site);
  ret.hash = '';
  const q = new URLSearchParams({ account, return: ret.toString() });
  const lang = parseLang(locale);
  if (lang) q.set('lang', lang);
  return `${LAUNCH_PATH}?${q.toString()}`;
}
