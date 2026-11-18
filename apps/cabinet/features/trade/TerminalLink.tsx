import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { terminalLaunchHref } from '@/lib/sso/launch';
import type { AccountKind } from '@/lib/sso/jwt';

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
