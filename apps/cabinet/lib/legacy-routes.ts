import { PLATFORM_LOCALES } from '@broker/utils/locales';

const LEGACY: Record<string, string> = {
  deposit: '/wallet?tab=deposit',
  withdraw: '/wallet?tab=withdraw',
  verification: '/profile?tab=verification',
  documents: '/profile?tab=documents',
  security: '/profile?tab=security',
};
const PREFIX = `(?:/(${PLATFORM_LOCALES.join('|')}))?`;
const LEGACY_PATH = new RegExp(`^${PREFIX}/(deposit|withdraw|verification|documents|security)/?$`);
const TRADE_PATH = new RegExp(`^${PREFIX}/trade/?$`);

export function legacyTarget(pathname: string, search: string): string | null {
  const m = LEGACY_PATH.exec(pathname);
  if (m) return `${m[1] ? `/${m[1]}` : ''}${LEGACY[m[2]!]}`;
  const trade = TRADE_PATH.exec(pathname);
  const account = new URLSearchParams(search).get('account');
  if (trade && (account === 'demo' || account === 'real')) {
    return `${trade[1] ? `/${trade[1]}` : ''}/terminal?account=${account}`;
  }
  return null;
}
