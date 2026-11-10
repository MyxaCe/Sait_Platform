/**
 * Старые адреса (r2: кошелёк и профиль объединены, терминал — на весь экран)
 * → новое место, настоящим 307 до рендера (страницы-заглушки остаются
 * запасным путём). Закладки и ссылки из писем продолжают работать.
 */
const LEGACY: Record<string, string> = {
  deposit: '/wallet?tab=deposit',
  withdraw: '/wallet?tab=withdraw',
  verification: '/profile?tab=verification',
  documents: '/profile?tab=documents',
  security: '/profile?tab=security',
};
const LEGACY_PATH = /^\/(en\/)?(deposit|withdraw|verification|documents|security)\/?$/;

export function legacyTarget(pathname: string, search: string): string | null {
  const m = LEGACY_PATH.exec(pathname);
  if (m) return `${m[1] ? '/en' : ''}${LEGACY[m[2]!]}`;
  const trade = /^\/(en\/)?trade\/?$/.exec(pathname);
  const account = new URLSearchParams(search).get('account');
  if (trade && (account === 'demo' || account === 'real')) {
    return `${trade[1] ? '/en' : ''}/terminal?account=${account}`;
  }
  return null;
}
