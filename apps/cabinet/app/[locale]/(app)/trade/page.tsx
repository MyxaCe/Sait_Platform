import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TerminalFrame } from '@/features/trade/TerminalFrame';
import { tenantSlug } from '@/lib/sso/jwt';

export default async function TradePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('trade');
  const terminalUrl = process.env.NEXT_PUBLIC_TERMINAL_URL;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {terminalUrl ? (
        <div className="mt-4">
          <TerminalFrame terminalUrl={terminalUrl} site={tenantSlug()} title={t('title')} />
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-border bg-elevated p-8 text-center">
          <p className="text-lg font-medium">{t('comingSoon')}</p>
          <p className="mt-2 text-sm text-secondary">{t('comingSoonHint')}</p>
        </div>
      )}
    </div>
  );
}
