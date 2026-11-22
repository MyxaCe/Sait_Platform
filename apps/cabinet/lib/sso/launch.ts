import { isPlatformLocale, type PlatformLocale } from '@broker/utils/locales';
import type { AccountKind } from './jwt';

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

export function parseLang(raw: string | null | undefined): PlatformLocale | null {
  return isPlatformLocale(raw) ? raw : null;
}

export function launchLocation(returnUrl: string, token: string, account: AccountKind, lang: PlatformLocale | null): string {
  const frag = new URLSearchParams({ handoff: token, account });
  if (lang) frag.set('lang', lang);
  return `${returnUrl}#${frag.toString()}`;
}

export const LAUNCH_PATH = '/api/sso/launch';

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

export function topLevelTerminalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERMINAL_TOP_LEVEL === '1' && !!env.NEXT_PUBLIC_TERMINAL_URL?.trim();
}

export function terminalLaunchHref(
  account: AccountKind,
  locale: string,
  env: NodeJS.ProcessEnv = process.env,
  symbol: string | null = null,
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
  if (symbol) ret.searchParams.set('symbol', symbol);
  ret.hash = '';
  const q = new URLSearchParams({ account, return: ret.toString() });
  const lang = parseLang(locale);
  if (lang) q.set('lang', lang);
  return `${LAUNCH_PATH}?${q.toString()}`;
}
