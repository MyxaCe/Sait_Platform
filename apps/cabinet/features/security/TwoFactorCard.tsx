import { getFormatter, getTranslations } from 'next-intl/server';
import { getTwoFactorStatus } from '@broker/support';
import { twoFactorPool } from '@/lib/two-factor';
import { TwoFactorPanel } from './TwoFactorPanel';

export async function TwoFactorCard({ userId }: { userId: string }) {
  const t = await getTranslations('twoFactor');
  const format = await getFormatter();
  const status = await getTwoFactorStatus(twoFactorPool(), userId);
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-elevated p-4 sm:p-5" id="two-factor">
      <h2 className="text-[15px] font-semibold">{t('title')}</h2>
      <p className="mt-1 text-xs text-secondary">{t('hint')}</p>
      <div className="mt-4 flex flex-1 flex-col">
        <TwoFactorPanel
          enabled={status.enabled}
          enabledSince={status.enabledAt ? format.dateTime(status.enabledAt, { dateStyle: 'long' }) : null}
          recoveryLeft={status.recoveryLeft}
        />
      </div>
    </section>
  );
}
