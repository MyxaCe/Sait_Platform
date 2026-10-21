import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSessionUser } from '@/lib/auth/session';
import { describeSlippage } from '@/lib/slippage';
import { getClosedDeals } from '@/lib/terminal/client';

/**
 * История закрытых сделок (CAB-09) и то, ради чего она заведена первой, —
 * **названное проскальзывание** (WEB-20, Р-178).
 *
 * Стоп исполняется по первой наблюдённой цене, а не по уровню. Значит
 * закрытие бывает хуже поставленного уровня, и **без объяснения это
 * читается как наша ошибка**. Поэтому здесь не просто две цифры рядом:
 * разница названа словами и названа её причина.
 *
 * Источник — ручка терминала, а не наша проекция: событий на шину он
 * пока не шлёт, а история в ручке есть уже сегодня.
 */
export default async function HistoryPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = (await getSessionUser())!;
  const t = await getTranslations('history');
  const outcome = await getClosedDeals(user.id);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      {outcome.state === 'unavailable' ? (
        /*
         * Отказ назван отказом. Пустой список здесь был бы утверждением
         * «сделок нет» — фактом о человеке вместо нашей неполадки.
         */
        <div className="mt-6 rounded-xl border border-border bg-elevated p-4">
          <p className="text-sm text-primary">{t('unavailable')}</p>
          <p className="mt-2 font-mono text-xs text-secondary">
            {t('reason', { reason: outcome.reason })}
          </p>
        </div>
      ) : outcome.deals.length === 0 ? (
        <p className="mt-6 text-sm text-secondary">{t('empty')}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {outcome.deals.map((deal, i) => {
            const price = (value: number) => value.toFixed(deal.priceDigits);
            const slippage = describeSlippage({
              execution: deal.exit,
              level: deal.level,
              side: deal.side,
              digits: deal.priceDigits,
            });

            return (
              <li
                key={`${deal.symbol}-${i}`}
                className="rounded-xl border border-border bg-elevated p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    {t('columns', {
                      side: deal.side,
                      volume: String(deal.volume),
                      symbol: deal.symbol,
                    })}
                  </span>
                  <span className="tabular-nums text-sm">
                    {t('result', { pnl: (deal.pnlCents / 100).toFixed(2) })}
                  </span>
                </div>

                <p className="mt-1 text-sm tabular-nums text-secondary">
                  {t('prices', { entry: price(deal.entry), exit: price(deal.exit) })}
                </p>

                {/*
                  Про уровень говорим, только когда он у нас есть.
                  `unknown` — закрытие не по уровню либо сделка старше
                  поля; в обоих случаях сказать нечего, и молчание здесь
                  честнее любой формулировки.
                */}
                {deal.level !== null && slippage.kind !== 'unknown' && (
                  <p className="mt-2 text-sm">
                    {slippage.kind === 'against'
                      ? t('slippageAgainst', {
                          amount: price(slippage.amount),
                          level: price(deal.level),
                        })
                      : slippage.kind === 'favour'
                        ? t('slippageFavour', {
                            amount: price(slippage.amount),
                            level: price(deal.level),
                          })
                        : t('slippageNone', { level: price(deal.level) })}
                  </p>
                )}

                {/*
                  Разрыв называем, только когда источник сказал «был».
                  `false` — проверяли, не было: говорить не о чем.
                  `null` — неизвестно, и молчать обязаны тем более.
                */}
                {deal.acrossGap === true && (
                  <p className="mt-1 text-xs text-secondary">{t('gap')}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
