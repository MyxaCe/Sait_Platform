import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cn } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { localeHref } from '@/i18n/redirect';
import { TerminalFrame } from '@/features/trade/TerminalFrame';
import { NavIcon } from '@/features/shell/NavIcon';
import { parseTerminalSymbol } from '@/lib/auth/public-paths';
import { requireSessionUser } from '@/lib/auth/require';
import { tenantSlug } from '@/lib/sso/jwt';
import { terminalLaunchHref } from '@/lib/sso/launch';
import { loadOnboardingState, loadTourConfig } from '@/lib/onboarding/server';
import { partOf, shouldAutostart } from '@/lib/onboarding/state';

export default async function TerminalPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { account?: string; symbol?: string };
}) {
  setRequestLocale(params.locale);
  const accountKind = searchParams.account === 'real' ? 'real' : 'demo';
  const symbol = parseTerminalSymbol(searchParams.symbol);
  const selfHref = (kind: 'demo' | 'real') =>
    `/terminal?${new URLSearchParams(symbol ? { account: kind, symbol } : { account: kind }).toString()}`;
  const user = await requireSessionUser(params.locale, await localeHref(selfHref(accountKind), params.locale));
  const launch = terminalLaunchHref(accountKind, params.locale, process.env, symbol);
  if (launch) redirect(launch);
  const [t, tourConfig, onboarding] = await Promise.all([
    getTranslations('trade'),
    loadTourConfig(params.locale),
    loadOnboardingState(user.id),
  ]);
  const terminalPart = partOf(tourConfig, 'terminal');
  const tour =
    terminalPart && tourConfig
      ? { part: terminalPart, labels: tourConfig.labels, autostart: shouldAutostart(onboarding, terminalPart) }
      : null;
  const terminalUrl = process.env.NEXT_PUBLIC_TERMINAL_URL;

  const seg = (kind: 'demo' | 'real', label: string) => (
    <Link
      href={selfHref(kind)}
      aria-current={accountKind === kind ? 'page' : undefined}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold',
        accountKind === kind
          ? kind === 'real'
            ? 'bg-accent text-on-accent'
            : 'bg-primary/10 text-primary'
          : 'text-secondary hover:text-primary',
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex h-svh flex-col bg-base">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-elevated pl-1 pr-2">
        <Link
          href="/"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-secondary hover:bg-primary/5 hover:text-primary"
        >
          <NavIcon name="site" className="size-[18px]" />
          {t('backToCabinet')}
        </Link>
        <nav aria-label={t('accountSwitch')} className="flex items-center gap-0.5 rounded-lg border border-border bg-base p-0.5">
          {seg('demo', t('badgeDemo'))}
          {seg('real', t('badgeReal'))}
        </nav>
      </div>
      {terminalUrl ? (
        <TerminalFrame
          terminalUrl={terminalUrl}
          site={tenantSlug()}
          title={t('title')}
          accountKind={accountKind}
          symbol={symbol}
          tour={tour}
          className="block min-h-0 w-full flex-1 border-0 bg-elevated"
        />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <p className="text-lg font-medium">{t('comingSoon')}</p>
            <p className="mt-2 max-w-sm text-sm text-secondary">{t('comingSoonHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
