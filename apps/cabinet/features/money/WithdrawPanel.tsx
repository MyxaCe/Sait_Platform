import { getTranslations } from 'next-intl/server';
import type { MoneyPolicy } from '@broker/money';
import { WithdrawForm } from './MoneyForms';
import { PolicyNotice } from './PolicyNotice';

/**
 * Вкладка «Вывести» кошелька (дизайн USDT §2): адрес TRON с проверкой формата,
 * сумма с «Макс.» в пределах доступного, шаг подтверждения перед отправкой.
 * Сумма резервируется в терминале при подаче; свободную маржу окончательно
 * проверяет терминал, его отказ виден человеку. Заморозку объясняет шапка
 * кошелька — здесь она не повторяется.
 */
export async function WithdrawPanel({
  policy,
  availableMinor,
}: {
  policy: MoneyPolicy;
  availableMinor: number;
}) {
  const t = await getTranslations('money');
  const reasons = policy.withdrawReasons.filter((r) => !(policy.frozen && r === 'frozen'));
  return (
    <div className="space-y-4">
      {!policy.withdrawAllowed && reasons.length > 0 ? <PolicyNotice op="withdraw" reasons={reasons} /> : null}
      <section className="rounded-2xl border border-border bg-elevated p-4 sm:p-5">
        <WithdrawForm
          disabled={!policy.withdrawAllowed}
          availableMinor={availableMinor}
          minMinor={policy.minWithdrawMinor}
        />
        <p className="mt-4 text-xs leading-relaxed text-muted">{t('withdrawNote')}</p>
      </section>
    </div>
  );
}
