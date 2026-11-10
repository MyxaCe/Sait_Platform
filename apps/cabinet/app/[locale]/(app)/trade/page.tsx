import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Callout, Money, ToneBadge } from '@broker/ui';
import { Link, redirect } from '@/i18n/navigation';
import { linkButton } from '@/features/ui/link-button';
import { requireSessionUser } from '@/lib/auth/require';
import { getDemoAccount } from '@/lib/data';
import { getMoneyPolicy, getRealAccount } from '@/lib/money';

/**
 * «Торговля» (r2): выбор счёта → терминал открывается НА ВЕСЬ ЭКРАН
 * (`/terminal?account=…`), без оболочки кабинета. Встроенный в кабинет
 * iframe убран (замечание владельца).
 *
 * Старые ссылки `/trade?account=demo|real` ведут прямо в терминал — выбор уже
 * сделан, лишний экран не нужен.
 */
export const dynamic = 'force-dynamic';

export default async function TradePage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { account?: string };
}) {
  setRequestLocale(params.locale);
  if (searchParams.account === 'real' || searchParams.account === 'demo') {
    redirect({ href: `/terminal?account=${searchParams.account}`, locale: params.locale });
  }
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('trade');
  const th = await getTranslations('home');
  const [real, demo, policy] = await Promise.all([
    getRealAccount(user.id),
    getDemoAccount(user.id),
    getMoneyPolicy(user.id),
  ]);
  const realEmpty = (real?.balanceCents ?? 0) <= 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-secondary">{t('chooseLead')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-accent/40 bg-elevated p-5" data-account="real">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-secondary">{th('realAccountTitle')}</h2>
            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-accent/[0.14] px-2 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/30">
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {th('badgeReal')}
            </span>
          </div>
          <p className="mt-3 text-[26px] font-semibold leading-9 tracking-tight">
            <Money minor={real?.balanceCents ?? 0} currency={real?.currency ?? 'USDT'} />
          </p>
          <p className="mt-1 flex-1 text-xs text-secondary">{t('realHint')}</p>
          {policy.frozen ? (
            <Callout tone="negative" className="mt-3" title={th('realFrozenTitle')}>
              {th('realFrozen')}
            </Callout>
          ) : realEmpty ? (
            <p className="mt-3 text-xs text-secondary">
              {t('realEmpty')}{' '}
              <Link href="/wallet?tab=deposit" className="font-medium text-accent hover:underline">
                {th('btnDeposit')}
              </Link>
            </p>
          ) : null}
          <Link href="/terminal?account=real" className={linkButton('primary', 'mt-5 w-full')}>
            {t('openTerminal')}
          </Link>
        </section>

        <section className="flex flex-col rounded-2xl border border-border bg-elevated p-5" data-account="demo">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-secondary">{th('demoAccountTitle')}</h2>
            <ToneBadge tone="neutral">{th('badgeDemo')}</ToneBadge>
          </div>
          <p className="mt-3 text-[26px] font-semibold leading-9 tracking-tight">
            {demo ? <Money minor={demo.balanceCents} currency={demo.currency} /> : th('balanceNoAccount')}
          </p>
          <p className="mt-1 flex-1 text-xs text-secondary">{t('demoHint')}</p>
          <Link href="/terminal?account=demo" className={linkButton('secondary', 'mt-5 w-full')}>
            {t('openTerminal')}
          </Link>
        </section>
      </div>

      <p className="text-xs text-muted">{t('fullscreenNote')}</p>
    </div>
  );
}
