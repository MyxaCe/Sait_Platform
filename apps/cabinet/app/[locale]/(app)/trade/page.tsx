import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TerminalFrame } from '@/features/trade/TerminalFrame';
import { tenantSlug } from '@/lib/sso/jwt';

/**
 * Терминал с выбором счёта (решение владельца 09.11): `?account=demo|real`.
 * Счёт уходит в SSO claim `account_kind`; без параметра — демо, как раньше.
 */
export default async function TradePage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { account?: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations('trade');
  const terminalUrl = process.env.NEXT_PUBLIC_TERMINAL_URL;
  const accountKind = searchParams.account === 'real' ? 'real' : 'demo';
  const prefix = params.locale === 'en' ? '/en' : '';

  const switcher = (
    <div className="flex items-center gap-2 border-b border-border bg-elevated px-4 py-2 text-sm">
      <span
        className={`rounded px-2 py-0.5 text-xs font-semibold ${
          accountKind === 'real' ? 'bg-accent text-base' : 'bg-card text-secondary'
        }`}
      >
        {accountKind === 'real' ? t('badgeReal') : t('badgeDemo')}
      </span>
      <Link
        href={`${prefix}/trade?account=${accountKind === 'real' ? 'demo' : 'real'}`}
        className="text-secondary hover:text-primary"
      >
        {accountKind === 'real' ? t('switchToDemo') : t('switchToReal')}
      </Link>
    </div>
  );

  // Терминал — full-bleed: гасим паддинги main отрицательными отступами,
  // высота = вьюпорт минус мобильные шапка (3.5rem) и нижняя навигация (3.5rem)
  return terminalUrl ? (
    <div className="-mx-4 -mt-6 -mb-24 sm:-mx-6 lg:-mx-10 lg:-my-6">
      {switcher}
      <TerminalFrame
        terminalUrl={terminalUrl}
        site={tenantSlug()}
        title={t('title')}
        accountKind={accountKind}
      />
    </div>
  ) : (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <div className="mt-6 rounded-2xl border border-border bg-elevated p-8 text-center">
        <p className="text-lg font-medium">{t('comingSoon')}</p>
        <p className="mt-2 text-sm text-secondary">{t('comingSoonHint')}</p>
      </div>
    </div>
  );
}
