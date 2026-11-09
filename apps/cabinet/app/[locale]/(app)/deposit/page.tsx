import QRCode from 'qrcode';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Callout, formatMoney } from '@broker/ui';
import { requireSessionUser } from '@/lib/auth/require';
import { exchangeAddress, getMoneyPolicy, listMyDeposits } from '@/lib/money';
import { DepositClaimForm } from '@/features/money/MoneyForms';
import { DepositHistory } from '@/features/money/MoneyHistory';
import { CopyButtonLarge } from '@/features/money/CopyText';
import { PolicyNotice } from '@/features/money/PolicyNotice';
import { MoneyPageHeader, Step } from '@/features/money/Step';

/**
 * «Пополнить» реальный счёт USDT TRC20 (дизайн §1), фаза 2:
 *   шаг 1 — адрес биржи из env + QR + копирование + крупное предупреждение
 *           «только USDT в сети TRON (TRC20)»;
 *   шаг 2 — хэш транзакции (проверка формата + подсказка, где его взять) →
 *           заявка `claimed`, наблюдатель сверяет её с сетью;
 *   история — статусы бейджами, хэши моноширинно + копирование + Tronscan.
 * Недоступно по политике — человеческая причина и действие; форма неактивна.
 * Адреса нет — реквизиты не показываются вовсе, кнопка неактивна (аудит К8).
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
  const enabled = policy.depositAllowed && address !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5">
      <MoneyPageHeader title={t('depositTitle')} lead={t('depositLead')} />

      {!policy.depositAllowed ? <PolicyNotice op="deposit" reasons={policy.depositReasons} /> : null}

      <Step n={1} title={t('step1Title')} muted={!enabled}>
        {address ? (
          <div className="space-y-4">
            <Callout tone="warning" title={t('warningTitle')}>
              {t('onlyUsdtWarning')}
            </Callout>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              {qr ? (
                <div
                  role="img"
                  className="size-44 shrink-0 rounded-xl bg-white p-2 sm:size-40"
                  aria-label={t('qrLabel')}
                  // SVG сгенерирован на сервере из адреса env, пользовательского ввода в нём нет.
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
              ) : null}
              <div className="w-full min-w-0 space-y-2">
                <p className="text-xs font-medium text-secondary">{t('addressLabel')}</p>
                <p
                  className="select-all break-all rounded-xl border border-border-strong bg-sunken px-3 py-3 font-mono text-[13px] leading-relaxed tracking-tight min-[400px]:text-[14px] sm:text-[15px]"
                  data-testid="deposit-address"
                >
                  {address}
                </p>
                <CopyButtonLarge
                  value={address}
                  label={t('copyAddress')}
                  doneLabel={t('copied')}
                  className="w-full sm:w-auto"
                />
                <p className="text-xs text-muted">{t('copyHint')}</p>
                <p className="text-xs text-secondary">
                  {t('minDeposit', { min: formatMoney(policy.minDepositMinor, 'USDT') })}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <Callout tone="neutral" title={t('addressMissingTitle')}>
            {t('addressMissing')}
          </Callout>
        )}
      </Step>

      <Step n={2} title={t('step2Title')} muted={!enabled}>
        <p className="mb-3 text-sm text-secondary">{t('step2')}</p>
        <DepositClaimForm disabled={!enabled} />
      </Step>

      <DepositHistory items={deposits} />
    </div>
  );
}
