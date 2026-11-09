import QRCode from 'qrcode';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@/lib/auth/require';
import { exchangeAddress, getMoneyPolicy, listMyDeposits } from '@/lib/money';
import { DepositClaimForm } from '@/features/money/MoneyForms';
import { DepositHistory } from '@/features/money/MoneyHistory';

/**
 * «Пополнить» реальный счёт USDT TRC20 (дизайн §1): адрес биржи из env + QR +
 * сеть + предупреждение «только USDT TRC20» + ввод хэша транзакции → заявка
 * `claimed`, наблюдатель сверяет её с сетью. Недоступно по политике —
 * причина видна, форма неактивна.
 */
export const dynamic = 'force-dynamic';

export default async function DepositPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('money');
  const [policy, deposits] = await Promise.all([getMoneyPolicy(user.id), listMyDeposits(user.id)]);
  const address = exchangeAddress();
  const qr = address
    ? await QRCode.toString(address, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    : null;
  const reasons = policy.depositReasons.map((r) => (t.has(`policy.${r}`) ? t(`policy.${r}`) : r)).join(', ');
  const enabled = policy.depositAllowed && address !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('depositTitle')}</h1>

      {!policy.depositAllowed ? (
        <p role="alert" className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {t('unavailable', { reasons })}
        </p>
      ) : null}

      {address ? (
        <section className="space-y-4 rounded-2xl border border-border bg-elevated p-5">
          <p className="text-sm font-semibold">{t('network')}</p>
          <p className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">{t('onlyUsdtWarning')}</p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {qr ? (
              <div
                className="size-44 shrink-0 rounded-xl bg-white p-2"
                aria-label={t('addressLabel')}
                // SVG сгенерирован на сервере из адреса env, пользовательского ввода в нём нет.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            ) : null}
            <div className="min-w-0 space-y-2">
              <p className="text-xs text-secondary">{t('addressLabel')}</p>
              <p className="select-all break-all font-mono text-base">{address}</p>
              <p className="text-xs text-secondary">{t('copyHint')}</p>
              <p className="text-xs text-secondary">
                {t('minDeposit', { min: (policy.minDepositMinor / 100).toFixed(2) })}
              </p>
            </div>
          </div>
        </section>
      ) : (
        <p className="rounded-xl border border-border bg-elevated px-4 py-3 text-sm text-secondary">{t('addressMissing')}</p>
      )}

      <section className="space-y-3 rounded-2xl border border-border bg-elevated p-5">
        <p className="text-sm text-secondary">{t('step2')}</p>
        <DepositClaimForm disabled={!enabled} />
      </section>

      <DepositHistory items={deposits} />
    </div>
  );
}
