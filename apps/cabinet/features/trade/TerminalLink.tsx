import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { terminalLaunchHref } from '@/lib/sso/launch';
import type { AccountKind } from '@/lib/sso/jwt';

/**
 * Кнопка «Торговать на демо/реальном». При `TERMINAL_TOP_LEVEL=1` — вход в
 * терминал верхним уровнем в ТОЙ ЖЕ вкладке через `/api/sso/launch`
 * (sso-pack v1.1; обычная ссылка `<a>` — маршрут API не локализуется).
 * Без флага — как раньше: полноэкранная `/terminal?account=…` с iframe
 * (она же остаётся запасным путём).
 */
export function TerminalLink({
  account,
  className,
  children,
}: {
  account: AccountKind;
  className?: string;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const launch = terminalLaunchHref(account, locale);
  if (launch) {
    return (
      <a href={launch} className={className} data-terminal-launch={account}>
        {children}
      </a>
    );
  }
  return (
    <Link href={`/terminal?account=${account}`} className={className}>
      {children}
    </Link>
  );
}
