import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@broker/ui';
import type { CabinetHomeModule } from '@broker/api-client';
import type { DemoAccount } from '@/lib/data';

type BalanceConfig = Extract<CabinetHomeModule, { type: 'balance' }>;

/**
 * Модуль «Общая стоимость»: демо-баланс + кнопки операций (состав из CMS).
 * Фиатные операции появятся с платёжным провайдером — кнопки честно
 * задизейблены с подписью, а не спрятаны (пользователь видит будущее).
 */
export async function BalanceModule({
  config,
  demo,
}: {
  config: BalanceConfig;
  demo: DemoAccount | null;
}) {
  const t = await getTranslations('home');
  const format = await getFormatter();

  const buttons: { key: 'deposit' | 'withdraw' | 'buyFiat'; label: string }[] = [];
  if (config.buttons.deposit) buttons.push({ key: 'deposit', label: t('btnDeposit') });
  if (config.buttons.withdraw) buttons.push({ key: 'withdraw', label: t('btnWithdraw') });
  if (config.buttons.buyFiat) buttons.push({ key: 'buyFiat', label: t('btnBuyFiat') });

  return (
    <section className="rounded-2xl border border-border bg-elevated p-5">
      <h2 className="text-sm text-secondary">{t('balanceTitle')}</h2>
      <p className="mt-2 text-3xl font-bold">
        {demo
          ? format.number(demo.balanceCents / 100, {
              style: 'currency',
              currency: demo.currency,
              maximumFractionDigits: 2,
            })
          : '—'}
      </p>
      <p className="mt-1 text-xs text-secondary">{t('balanceDemoNote')}</p>
      {buttons.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {buttons.map((b) => (
            <Button key={b.key} size="sm" variant={b.key === 'deposit' ? 'primary' : 'secondary'} disabled>
              {b.label}
            </Button>
          ))}
          <span className="text-xs text-secondary/80">{t('fiatSoon')}</span>
        </div>
      )}
    </section>
  );
}
