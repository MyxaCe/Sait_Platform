'use client';

import { useTranslations } from 'next-intl';
import {
  useConnectionStatus,
  useRealtimeQuotes,
  type SymbolDef,
} from '@broker/realtime';
import { Button, ConnectionDot, PriceChange, cn } from '@broker/ui';
import { formatPrice } from '@broker/utils';
import { QuotePrice, priceReading } from './QuotePrice';
import { usePriceFlash } from './usePriceFlash';

/** Примерный спред по категориям (доля цены) — до подключения реального фида bid/ask */
const SPREAD_FACTOR: Record<SymbolDef['category'], number> = {
  forex: 0.00006,
  metals: 0.0001,
  crypto: 0.0004,
  indices: 0.00008,
  stocks: 0.0002,
  energy: 0.00025,
};

export function LiveQuotePanel({ def }: { def: SymbolDef }) {
  const t = useTranslations('instruments');
  const tConn = useTranslations('connection');
  const [quote] = useRealtimeQuotes([def.symbol]);
  const status = useConnectionStatus();

  /*
    Было `quote?.price ?? def.basePrice` — подстановка справочной цены
    на место живой, самой крупной цифрой страницы (WEB-17). `basePrice`
    из справочника означает «инструмент такой существует», а не «он
    стоит столько»: это не старая котировка, а цифра из описания, и
    показать её как цену значит утверждать сделку, которой не было.

    Гейт ОДИН — общее правило `displayPrice`. Число для bid/ask берётся
    только тогда, когда правило согласилось показать цену: написать
    здесь `quote.ts !== 0` значило бы завести второй источник того же
    условия, и при переносе порога наружу он остался бы прежним.
  */
  const reading = priceReading(quote);

  const flash = usePriceFlash(reading);

  /*
    Bid и ask СЧИТАЮТСЯ из цены, значит без цены их нет. Раньше они
    считались из подставленной и выглядели как настоящие котировки на
    покупку и продажу — по ним можно принять решение.
  */
  const halfSpread = reading === null ? null : (reading * SPREAD_FACTOR[def.category]) / 2;
  const bid =
    reading === null || halfSpread === null ? null : formatPrice(reading - halfSpread, def.digits);
  const ask =
    reading === null || halfSpread === null ? null : formatPrice(reading + halfSpread, def.digits);

  return (
    <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <div className="flex items-center gap-2 text-xs text-secondary">
        <ConnectionDot status={status} label={tConn(status)} />
        {status === 'connected' ? t('panelLive') : t('panelConnecting')}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span
          className={cn(
            'text-4xl font-semibold tabular-nums tracking-tight text-primary transition-colors duration-500 sm:text-5xl',
            flash === 'up' && 'text-positive',
            flash === 'down' && 'text-negative',
          )}
        >
          <QuotePrice quote={quote} noDataLabel={tConn('noData')} />
        </span>
        {/*
          Было `?? 0` — подстановка, прямо запрещённая контрактом: на крупной
          цифре страницы инструмента она показывала уверенное «0.00%». Нулём
          подменялись сразу два разных незнания — котировки ещё нет и
          изменение не пришло, — и оба читались как «цена не изменилась».
        */}
        <PriceChange value={quote?.changePercent ?? null} className="text-base" />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-6 text-sm">
        <div>
          <dt className="text-secondary">Bid</dt>
          <dd className="mt-1 tabular-nums text-negative">
            {bid ?? <span className="text-secondary" title={tConn('noData')}>—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-secondary">Ask</dt>
          <dd className="mt-1 tabular-nums text-positive">
            {ask ?? <span className="text-secondary" title={tConn('noData')}>—</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" className="w-full sm:flex-1">
          {t('tradeSymbol', { symbol: def.symbol })}
        </Button>
        <Button variant="secondary" size="lg" className="w-full sm:flex-1">
          {t('tryOnDemo')}
        </Button>
      </div>
    </div>
  );
}
