import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { terminalLaunchHref } from '@/lib/sso/launch';
import type { AccountKind } from '@/lib/sso/jwt';
import { parseTerminalSymbol } from '@/lib/auth/public-paths';
import { terminalPageHref } from './terminal-href';

/**
 * Кнопка «Торговать на демо/реальном». При `TERMINAL_TOP_LEVEL=1` — вход в
 * терминал верхним уровнем в ТОЙ ЖЕ вкладке через `/api/sso/launch`
 * (sso-pack v1.1; обычная ссылка `<a>` — маршрут API не локализуется).
 * Без флага — как раньше: полноэкранная `/terminal?account=…` с iframe
 * (она же остаётся запасным путём).
 */
export function TerminalLink({
  account,
  symbol,
  className,
  children,
}: {
  account: AccountKind;
  symbol?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const launch = terminalLaunchHref(account, locale, process.env, parseTerminalSymbol(symbol));
  if (launch) {
    return (
      <a href={launch} className={className} data-terminal-launch={account}>
        {children}
      </a>
    );
  }
  return (
    <Link href={terminalPageHref(account, symbol)} className={className}>
      {children}
    </Link>
  );
}
