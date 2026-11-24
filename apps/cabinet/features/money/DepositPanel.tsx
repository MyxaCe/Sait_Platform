import QRCode from 'qrcode';
import { getLocale, getTranslations } from 'next-intl/server';
import { Callout } from '@broker/ui';
import type { MoneyPolicy } from '@broker/money';
import { DepositClaimForm } from './MoneyForms';
import { CopyButtonLarge } from './CopyText';
import { PolicyNotice } from './PolicyNotice';
import { REAL_ACCOUNT_CURRENCY } from '@broker/money/display-currency';
import { Step } from './Step';
import { moneyFormat } from '@/features/ui/money-format';

export async function DepositPanel({ policy, address }: { policy: MoneyPolicy; address: string | null }) {
  const fmt = moneyFormat(await getLocale());
  const t = await getTranslations('money');
  const qr = address
    ? await QRCode.toString(address, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    : null;
  const enabled = policy.depositAllowed && address !== null;

  const notice = !policy.depositAllowed;
  return (
    <div className="space-y-4 sm:space-y-5 xl:grid xl:grid-cols-2 xl:items-stretch xl:gap-5 xl:space-y-0">
      {notice ? (
        <div className="xl:col-span-2">
          <PolicyNotice op="deposit" reasons={policy.depositReasons} />
        </div>
      ) : null}

      <Step n={1} title={t('step1Title')} muted={!enabled} className="h-full">
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
                  {t('minDeposit', { min: fmt.money(policy.minDepositMinor, REAL_ACCOUNT_CURRENCY) })}
                </p>
              </div>
            </div>
          </div>
        ) : (
          // Адреса нет — сообщение по центру карточки, чтобы низ не пустовал рядом с шагом 2.
          <div className="flex h-full items-center">
            <Callout tone="neutral" title={t('addressMissingTitle')} className="w-full">
              {t('addressMissing')}
            </Callout>
          </div>
        )}
      </Step>

      <Step n={2} title={t('step2Title')} muted={!enabled} className="h-full">
        <p className="mb-3 text-sm text-secondary">{t('step2')}</p>
        <DepositClaimForm disabled={!enabled} />
      </Step>
    </div>
  );
}
