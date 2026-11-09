import { getTranslations } from 'next-intl/server';
import { Button, Callout, Money, ToneBadge } from '@broker/ui';
import type { CabinetHomeModule } from '@broker/api-client';
import type { MoneyPolicy, MoneyPolicyReason } from '@broker/money';
import { Link } from '@/i18n/navigation';
import { DemoResetForm } from './DemoResetForm';
import { PolicyNotice } from '@/features/money/PolicyNotice';
import { linkButton } from '@/features/ui/link-button';
import type { DemoAccount } from '@/lib/data';
import type { TenantStartBalance } from '@/lib/tenant';
import type { RealAccountView } from '@/lib/money';

type BalanceConfig = Extract<CabinetHomeModule, { type: 'balance' }>;

/** Живые цифры одного счёта из терминала; `null` поля — терминал их не знает. */
export interface LiveAccountFigures {
  equityMinor: number | null;
  freeMarginMinor: number | null;
  leverage: number | null;
}

/** Реальный счёт на главной (демо и реальный счёт разделены, решение владельца 09.11). */
export interface RealAccountBlock {
  account: RealAccountView | null;
  policy: MoneyPolicy;
  /** Живые цифры терминала; null — терминал не ответил / не настроен / счёта нет. */
  live: LiveAccountFigures | null;
  /** Терминал ответил — иначе показываем «данные счёта временно недоступны». */
  terminalOk: boolean;
  /** Живые цифры ДЕМО-счёта из того же ответа терминала; null — нет. */
  demoLive: LiveAccountFigures | null;
  /** Адрес биржи для ввода настроен (env). Нет — пополнение честно недоступно. */
  depositAddressReady: boolean;
  locale: string;
}

/**
 * Модуль «Счета» (фаза 2): РЕАЛЬНЫЙ счёт (USDT, ввод/вывод, торговля) и
 * ДЕМО-счёт (учебные деньги, сброс) — две карточки, различимые с первого
 * взгляда: бейдж «Реальный» на золотой рамке против нейтрального «Демо».
 *
 * Суммы — только `<Money>` (табличные цифры, валюта явно). Недоступная по
 * политике кнопка остаётся на месте, а под ней — человеческое объяснение и
 * действие («Пройти верификацию»), без машинных кодов (аудит К6/К7).
 *
 * Сброс демо-счёта без назначенной стартовой суммы (Р-040) — кнопка на месте
 * и говорит, почему не работает.
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {real ? (
        <RealAccountCard real={real} showDeposit={config.buttons.deposit} showWithdraw={config.buttons.withdraw} />
      ) : null}

      <section
        className="flex flex-col rounded-2xl border border-border bg-elevated p-5"
        data-account="demo"
        aria-labelledby="acc-demo-title"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="acc-demo-title" className="text-sm font-medium text-secondary">
            {t('demoAccountTitle')}
          </h2>
          <ToneBadge tone="neutral">{t('badgeDemo')}</ToneBadge>
        </div>
        {/*
          Строки счёта может не быть вовсе, и после WEB-29 это обычное
          состояние каждого нового пользователя: счёт заводит терминал
          при первом входе туда, а не сайт при регистрации.
        */}
        <p className="mt-3 text-xs text-muted">{t('balanceLabel')}</p>
        {demo ? (
          <p className="mt-0.5 text-[28px] font-semibold leading-9 tracking-tight">
            <Money minor={demo.balanceCents} currency={demo.currency} />
          </p>
        ) : (
          <p className="mt-0.5 text-lg font-semibold">{t('balanceNoAccount')}</p>
        )}
        <p className="mt-1 text-xs text-secondary">{demo ? t('balanceDemoNote') : t('balanceNoAccountNote')}</p>

        {demo && real?.demoLive ? (
          <Facts
            items={[
              { label: t('factEquity'), value: <Money minor={real.demoLive.equityMinor} currency={demo.currency} /> },
              {
                label: t('factFreeMargin'),
                value: <Money minor={real.demoLive.freeMarginMinor} currency={demo.currency} />,
              },
              {
                label: t('factLeverage'),
                value: real.demoLive.leverage ? t('leverageValue', { leverage: real.demoLive.leverage }) : '—',
              },
            ]}
          />
        ) : null}

        <div className="mt-auto flex flex-col gap-2 pt-5 sm:flex-row sm:flex-wrap sm:items-start">
          <Link href="/trade?account=demo" className={linkButton('secondary', 'w-full sm:w-auto')}>
            {t('tradeDemo')}
          </Link>
          {/* Сброс демо-счёта к стартовому балансу (server action). Сумму
              назначает владелец в CMS; не назначена — об этом написано рядом. */}
          {demo &&
            (startBalance.state === 'set' ? (
              <DemoResetForm
                className="w-full sm:w-auto"
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
        </div>
      </section>
    </div>
  );
}

function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-border pt-4 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs text-muted">{it.label}</dt>
          <dd className="mt-0.5 whitespace-nowrap text-sm font-medium tabular-nums">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

async function RealAccountCard({
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
  const { policy } = real;
  const currency = real.account?.currency ?? 'USDT';

  // Заморозку объясняет свой Callout выше кнопок — в списке причин она не повторяется.
  const notFrozen = (r: MoneyPolicyReason) => !(policy.frozen && r === 'frozen');
  const withdrawReasons = showWithdraw ? policy.withdrawReasons.filter(notFrozen) : [];
  // Причина, общая для ввода и вывода, показывается один раз.
  const depositReasons = showDeposit
    ? policy.depositReasons.filter(notFrozen).filter((r) => !withdrawReasons.includes(r))
    : [];
  const addressMissing = showDeposit && policy.depositAllowed && !real.depositAddressReady;
  const hasNotes = withdrawReasons.length > 0 || depositReasons.length > 0 || addressMissing;

  return (
    <section
      className="flex flex-col rounded-2xl border border-accent/40 bg-elevated p-5"
      data-account="real"
      aria-labelledby="acc-real-title"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="acc-real-title" className="text-sm font-medium text-secondary">
          {t('realAccountTitle')}
        </h2>
        <span className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-accent/[0.14] px-2 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/30">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {t('badgeReal')}
        </span>
      </div>

      <p className="mt-3 text-xs text-muted">{t('balanceLabel')}</p>
      <p className="mt-0.5 text-[28px] font-semibold leading-9 tracking-tight">
        <Money minor={real.account?.balanceCents ?? 0} currency={currency} />
      </p>
      <p className="mt-1 text-xs text-secondary">{t('realNote')}</p>

      {real.live ? (
        <Facts
          items={[
            { label: t('factEquity'), value: <Money minor={real.live.equityMinor} currency={currency} /> },
            { label: t('factFreeMargin'), value: <Money minor={real.live.freeMarginMinor} currency={currency} /> },
            {
              label: t('factLeverage'),
              value: real.live.leverage ? t('leverageValue', { leverage: real.live.leverage }) : '—',
            },
          ]}
        />
      ) : null}

      {!real.terminalOk || policy.frozen ? (
        <div className="mt-4 flex flex-col gap-3">
          {!real.terminalOk ? (
            <Callout tone="neutral" title={t('liveUnavailableTitle')}>
              {t('liveUnavailableText')}
            </Callout>
          ) : null}
          {policy.frozen ? (
            <Callout tone="negative" title={t('realFrozenTitle')}>
              {t('realFrozen')}
            </Callout>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto grid grid-cols-3 gap-2 pt-5">
        {showDeposit ? (
          <div data-money-button="deposit" data-allowed={String(policy.depositAllowed)} className="grid">
            {policy.depositAllowed && real.depositAddressReady ? (
              <Link href="/deposit" className={linkButton('primary', 'px-2')}>
                {t('btnDeposit')}
              </Link>
            ) : (
              <Button size="md" variant="primary" disabled className="px-2">
                {t('btnDeposit')}
              </Button>
            )}
          </div>
        ) : null}
        {showWithdraw ? (
          <div data-money-button="withdraw" data-allowed={String(policy.withdrawAllowed)} className="grid">
            {policy.withdrawAllowed ? (
              <Link href="/withdraw" className={linkButton('secondary', 'px-2')}>
                {t('btnWithdraw')}
              </Link>
            ) : (
              <Button size="md" variant="secondary" disabled className="px-2">
                {t('btnWithdraw')}
              </Button>
            )}
          </div>
        ) : null}
        {/* Заморозку проверяет терминал: замороженный должен иметь возможность закрыть позиции. */}
        {!policy.blocked ? (
          <Link href="/trade?account=real" className={linkButton('secondary', 'px-2')}>
            {t('btnTrade')}
          </Link>
        ) : null}
      </div>

      {hasNotes ? (
        <div className="mt-3 flex flex-col gap-2">
          {withdrawReasons.length > 0 ? <PolicyNotice op="withdraw" reasons={withdrawReasons} compact /> : null}
          {depositReasons.length > 0 ? <PolicyNotice op="deposit" reasons={depositReasons} compact /> : null}
          {addressMissing ? <Callout tone="neutral">{tm('addressMissingTitle')}</Callout> : null}
        </div>
      ) : null}
    </section>
  );
}
