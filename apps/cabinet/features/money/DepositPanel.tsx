import QRCode from 'qrcode';
import { getTranslations } from 'next-intl/server';
import { Callout, formatMoney } from '@broker/ui';
import type { MoneyPolicy } from '@broker/money';
import { DepositClaimForm } from './MoneyForms';
import { CopyButtonLarge } from './CopyText';
import { PolicyNotice } from './PolicyNotice';
import { REAL_ACCOUNT_CURRENCY } from '@broker/money/display-currency';
import { Step } from './Step';

/**
 * Вкладка «Пополнить» кошелька (дизайн USDT §1):
 *   шаг 1 — адрес биржи из env + QR + копирование + крупное предупреждение
 *           «только USDT в сети TRON (TRC20)»;
 *   шаг 2 — хэш транзакции (проверка формата + подсказка) → заявка `claimed`.
 * Недоступно по политике — человеческая причина и действие; форма неактивна.
 * Адреса нет — реквизиты не показываются вовсе (аудит К8).
 */
export async function DepositPanel({ policy, address }: { policy: MoneyPolicy; address: string | null }) {
  const t = await getTranslations('money');
  const qr = address
    ? await QRCode.toString(address, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    : null;
  const enabled = policy.depositAllowed && address !== null;

  return (
    <div className="space-y-4">
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
                  {t('minDeposit', { min: formatMoney(policy.minDepositMinor, REAL_ACCOUNT_CURRENCY) })}
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
    </div>
  );
}
