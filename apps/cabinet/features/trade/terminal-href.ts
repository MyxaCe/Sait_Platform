import { parseTerminalSymbol } from '@/lib/auth/public-paths';
import type { AccountKind } from '@/lib/sso/jwt';

export function terminalPageHref(account: AccountKind, symbol?: string | null): string {
  const canonical = parseTerminalSymbol(symbol);
  const query = new URLSearchParams(canonical ? { account, symbol: canonical } : { account });
  return `/terminal?${query.toString()}`;
}
