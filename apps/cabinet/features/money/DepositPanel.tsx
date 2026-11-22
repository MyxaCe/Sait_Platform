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
  const row = notice ? '2xl:row-start-2' : '2xl:row-start-1';
  return (
    <div className="space-y-4 2xl:grid 2xl:grid-cols-2 2xl:items-start 2xl:gap-5 2xl:space-y-0">
      {notice ? (
        <div className="2xl:col-span-2">
          <PolicyNotice op="deposit" reasons={policy.depositReasons} />
        </div>
      ) : null}

      <Step n={1} title={t('step1Title')} muted={!enabled} className={`2xl:col-start-1 ${row}`}>
        {address ? (
          <div className="space-y-4">
            <Callout tone="warning" title={t('warningTitle')}>
              {t('onlyUsdtWarning')}
            </Callout>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start 2xl:flex-col 2xl:items-start">
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
          <Callout tone="neutral" title={t('addressMissingTitle')}>
            {t('addressMissing')}
          </Callout>
        )}
      </Step>

      <Step n={2} title={t('step2Title')} muted={!enabled} className={`2xl:col-start-2 ${row}`}>
        <p className="mb-3 text-sm text-secondary">{t('step2')}</p>
        <DepositClaimForm disabled={!enabled} />
      </Step>
    </div>
  );
}
