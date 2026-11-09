import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@broker/ui';
import type { CabinetHomeModule } from '@broker/api-client';
import type { MoneyPolicy } from '@broker/money';
import { DemoResetForm } from './DemoResetForm';
import type { DemoAccount } from '@/lib/data';
import type { TenantStartBalance } from '@/lib/tenant';
import type { RealAccountView } from '@/lib/money';

type BalanceConfig = Extract<CabinetHomeModule, { type: 'balance' }>;

/** Реальный счёт на главной (демо и реальный счёт разделены, решение владельца 09.11). */
export interface RealAccountBlock {
  account: RealAccountView | null;
  policy: MoneyPolicy;
  /** Живые цифры терминала; null — терминал не ответил / не настроен. */
  live: { equityMinor: number | null; freeMarginMinor: number | null; leverage: number | null } | null;
  /**
   * Плечо ДЕМО-счёта из того же ответа терминала (`GET …/accounts`): плечо
   * следующей позиции. `null` — терминал не ответил или счёта ещё нет.
   */
  demoLeverage: number | null;
  locale: string;
}

/**
 * Модуль «Счета»: РЕАЛЬНЫЙ счёт (USDT, ввод/вывод) и ДЕМО-счёт (игрушечные
 * деньги, сброс). Состав кнопок — из CMS; ввод/вывод теперь живые и только
 * у реального счёта. Недоступная по политике кнопка не прячется, а говорит,
 * почему не работает (Р-025, п. 3).
 *
 * Тем же способом показан и недоступный сброс демо-счёта: когда владелец
 * не назначил стартовую сумму (Р-040), кнопка остаётся на месте и
 * говорит, почему не работает.
 */
export async function BalanceModule({
  config,
  demo,
  startBalance,
  real,
}: {
  config: BalanceConfig;
  demo: DemoAccount | null;
  startBalance: TenantStartBalance;
  real?: RealAccountBlock;
}) {
  const t = await getTranslations('home');
  const format = await getFormatter();
  const prefix = real?.locale === 'en' ? '/en' : '';

  // У демо остаётся лишь фиатная кнопка «скоро» (её состав решает CMS).
  const buttons: { key: 'buyFiat'; label: string }[] = [];
  if (config.buttons.buyFiat) buttons.push({ key: 'buyFiat', label: t('btnBuyFiat') });

  return (
    <div className="flex flex-col gap-4">
      {real ? (
        <RealAccountSection real={real} showDeposit={config.buttons.deposit} showWithdraw={config.buttons.withdraw} />
      ) : null}
      <section className="rounded-2xl border border-border bg-elevated p-5" data-account="demo">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm text-secondary">{t('demoAccountTitle')}</h2>
          <Link href={`${prefix}/trade?account=demo`} className="text-sm text-accent hover:underline">
            {t('tradeDemo')} →
          </Link>
        </div>
        {/*
          Строки счёта может не быть вовсе, и после WEB-29 это обычное
          состояние каждого нового пользователя: счёт заводит терминал
          при первом входе туда, а не сайт при регистрации.
        */}
        <p className="mt-2 text-3xl font-bold">
          {demo
            ? format.number(demo.balanceCents / 100, {
                style: 'currency',
                currency: demo.currency,
                maximumFractionDigits: 2,
              })
            : t('balanceNoAccount')}
        </p>
        <p className="mt-1 text-xs text-secondary">
          {demo ? t('balanceDemoNote') : t('balanceNoAccountNote')}
        </p>
        {real?.demoLeverage ? (
          <p className="mt-1 text-xs text-secondary">{t('accountLeverage', { leverage: real.demoLeverage })}</p>
        ) : null}
        {buttons.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {buttons.map((b) => (
              <Button key={b.key} size="sm" variant="secondary" disabled>
                {b.label}
              </Button>
            ))}
            <span className="text-xs text-secondary/80">{t('fiatSoon')}</span>
          </div>
        )}
        {/* Сброс демо-счёта к стартовому балансу (server action). Сумму
            назначает владелец в CMS; не назначена — об этом написано рядом. */}
        {demo &&
          (startBalance.state === 'set' ? (
            <DemoResetForm
              label={t('btnResetDemo')}
              texts={{
                resetAccepted: t('resetAccepted'),
                resetPositionsOpen: t('resetPositionsOpen'),
                resetNotDemo: t('resetNotDemo'),
                resetRefused: t('resetRefused'),
                resetUnavailable: t('resetUnavailable'),
                resetTooOften: t('resetTooOften'),
                resetNoSession: t('resetNoSession'),
              }}
            />
          ) : (
            <div
              className="mt-3"
              data-demo-reset="blocked"
              data-reason={startBalance.state === 'unset' ? 'unset' : startBalance.reason}
            >
              <Button size="sm" variant="ghost" disabled>
                {t('btnResetDemo')}
              </Button>
              <p className="mt-1 text-xs text-secondary">
                {startBalance.state === 'unset' ? t('resetUnsetNote') : t('resetUnavailableNote')}
              </p>
            </div>
          ))}
      </section>
    </div>
  );
}

function usdt(cents: number): string {
  return `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

async function RealAccountSection({
  real,
  showDeposit,
  showWithdraw,
}: {
  real: RealAccountBlock;
  showDeposit: boolean;
  showWithdraw: boolean;
}) {
  const t = await getTranslations('home');
  const tm = await getTranslations('money');
  const prefix = real.locale === 'en' ? '/en' : '';
  const why = (reasons: string[]) =>
    t('moneyUnavailable', {
      reasons: reasons.map((r) => (tm.has(`policy.${r}`) ? tm(`policy.${r}`) : r)).join(', '),
    });

  return (
    <section className="rounded-2xl border border-accent/40 bg-elevated p-5" data-account="real">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm text-secondary">{t('realAccountTitle')}</h2>
        {/* Заморозку проверяет терминал: замороженный должен иметь возможность закрыть позиции. */}
        {!real.policy.blocked ? (
          <Link href={`${prefix}/trade?account=real`} className="text-sm text-accent hover:underline">
            {t('tradeReal')} →
          </Link>
        ) : null}
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums">
        {real.account ? usdt(real.account.balanceCents) : t('realNoAccount')}
      </p>
      <p className="mt-1 text-xs text-secondary">{t('realNote')}</p>
      {real.live && real.live.equityMinor !== null ? (
        <p className="mt-1 text-xs text-secondary">
          {t('liveEquity', {
            equity: usdt(real.live.equityMinor),
            free: real.live.freeMarginMinor === null ? '—' : usdt(real.live.freeMarginMinor),
          })}
        </p>
      ) : null}
      {real.live?.leverage ? (
        <p className="mt-1 text-xs text-secondary">{t('accountLeverage', { leverage: real.live.leverage })}</p>
      ) : null}
      {real.policy.frozen ? <p className="mt-2 text-xs text-negative">{t('realFrozen')}</p> : null}
      <div className="mt-4 flex flex-wrap items-start gap-3">
        {showDeposit ? (
          <div data-money-button="deposit" data-allowed={String(real.policy.depositAllowed)}>
            {real.policy.depositAllowed ? (
              <Link
                href={`${prefix}/deposit`}
                className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-base"
              >
                {t('btnDeposit')}
              </Link>
            ) : (
              <>
                <Button size="sm" variant="primary" disabled>
                  {t('btnDeposit')}
                </Button>
                <p className="mt-1 max-w-[16rem] text-xs text-secondary">{why(real.policy.depositReasons)}</p>
              </>
            )}
          </div>
        ) : null}
        {showWithdraw ? (
          <div data-money-button="withdraw" data-allowed={String(real.policy.withdrawAllowed)}>
            {real.policy.withdrawAllowed ? (
              <Link
                href={`${prefix}/withdraw`}
                className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium"
              >
                {t('btnWithdraw')}
              </Link>
            ) : (
              <>
                <Button size="sm" variant="secondary" disabled>
                  {t('btnWithdraw')}
                </Button>
                <p className="mt-1 max-w-[16rem] text-xs text-secondary">{why(real.policy.withdrawReasons)}</p>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
