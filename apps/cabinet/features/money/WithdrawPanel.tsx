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
  const notice = !policy.withdrawAllowed && reasons.length > 0;
  return (
    <div className="space-y-4 2xl:grid 2xl:grid-cols-2 2xl:items-start 2xl:gap-5 2xl:space-y-0">
      {notice ? (
        <div className="2xl:col-span-2">
          <PolicyNotice op="withdraw" reasons={reasons} />
        </div>
      ) : null}
      <section className="rounded-2xl border border-border bg-elevated p-4 sm:p-5">
        <WithdrawForm
          disabled={!policy.withdrawAllowed}
          availableMinor={availableMinor}
          minMinor={policy.minWithdrawMinor}
        />
        <p className="mt-4 text-xs leading-relaxed text-muted">{t('withdrawNote')}</p>
      </section>
      {/* ≥ 2xl: рядом с формой — как проходит вывод (средняя колонка). */}
      <section className="hidden rounded-2xl border border-border bg-elevated p-5 2xl:block" aria-labelledby="wd-guide">
        <h2 id="wd-guide" className="text-[15px] font-semibold">
          {t('guideTitle')}
        </h2>
        <ol className="mt-4 space-y-3">
          {(['address', 'reserve', 'review', 'sent'] as const).map((k, i) => (
            <li key={k} className="flex gap-3 text-sm">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-xs font-semibold text-secondary">
                {i + 1}
              </span>
              <span>
                <span className="block font-medium">{t(`guide.${k}.title`)}</span>
                <span className="block text-xs leading-relaxed text-secondary">{t(`guide.${k}.text`)}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
