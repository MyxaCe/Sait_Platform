'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  SYMBOL_UNIVERSE,
  useConnectionStatus,
  useRealtimeQuotes,
  type InstrumentCategory,
  type Quote,
} from '@broker/realtime';
import { Button, ConnectionDot, Input, PriceChange, cn } from '@broker/ui';
import { formatPrice } from '@broker/utils';
import { CATEGORY_ORDER } from './categories';
import { usePriceFlash } from './usePriceFlash';

const ALL_SYMBOLS = SYMBOL_UNIVERSE.map((d) => d.symbol);

type CategoryFilter = InstrumentCategory | 'all';

export function InstrumentsBrowser() {
  const t = useTranslations('instruments');
  const tCat = useTranslations('categories');
  const tConn = useTranslations('connection');
  const tCommon = useTranslations('common');

  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');

  // Начальный фильтр из ?category= (читаем на клиенте, чтобы страница
  // оставалась статической и не требовала Suspense для useSearchParams)
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('category');
    if (fromUrl && (CATEGORY_ORDER as string[]).includes(fromUrl)) {
      setCategory(fromUrl as InstrumentCategory);
    }
  }, []);

  const quotes = useRealtimeQuotes(ALL_SYMBOLS);
  const status = useConnectionStatus();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (category !== 'all' && quote.category !== category) return false;
      if (!q) return true;
      return quote.symbol.toLowerCase().includes(q) || quote.name.toLowerCase().includes(q);
    });
  }, [quotes, category, query]);

  return (
    <div>
      {/* Панель фильтров: поиск + категории. На mobile категории скроллятся горизонтально */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0 lg:pb-0"
             style={{ scrollbarWidth: 'none' }}>
          {(['all', ...CATEGORY_ORDER] as CategoryFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              aria-pressed={category === value}
              className={cn(
                'min-h-[40px] shrink-0 rounded-full border px-4 text-sm transition-colors',
                category === value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-card text-secondary hover:text-primary',
              )}
            >
              {tCat(value)}
            </button>
          ))}
        </div>

        <div className="w-full lg:max-w-xs">
          <Input
            type="search"
            inputMode="search"
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchAria')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-secondary">
        <ConnectionDot status={status} label={tConn(status)} />
        <span>
          {status === 'connected' ? t('statusLive') : t('statusConnecting')} ·{' '}
          {t('counter', { filtered: filtered.length, total: quotes.length })}
        </span>
      </div>

      {/* Mobile: список карточек-строк */}
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border md:hidden">
        {filtered.map((q) => (
          <MobileRow key={q.symbol} quote={q} />
        ))}
      </ul>

      {/* Desktop: полная таблица */}
      <div className="mt-4 hidden overflow-hidden rounded-2xl border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-elevated text-left text-secondary">
            <tr>
              <th className="px-6 py-4 font-medium">{t('colInstrument')}</th>
              <th className="px-6 py-4 font-medium">{t('colCategory')}</th>
              <th className="px-6 py-4 text-right font-medium">{t('colPrice')}</th>
              <th className="px-6 py-4 text-right font-medium">{t('colChange')}</th>
              <th className="px-6 py-4" aria-hidden />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((q) => (
              <DesktopRow key={q.symbol} quote={q} categoryLabel={tCat(q.category)} tradeLabel={tCommon('trade')} />
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="mt-8 text-center text-secondary">{t('notFound')}</p>
      )}
    </div>
  );
}

function instrumentHref(q: Quote) {
  return `/instruments/${q.category}/${q.symbol.toLowerCase()}`;
}

const FLASH_CLASSES = {
  up: 'bg-positive/10',
  down: 'bg-negative/10',
} as const;

function MobileRow({ quote }: { quote: Quote }) {
  const flash = usePriceFlash(quote.price);
  return (
    <li className={cn('transition-colors duration-500', flash && FLASH_CLASSES[flash])}>
      <Link href={instrumentHref(quote)} className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <p className="font-medium text-primary">{quote.symbol}</p>
          <p className="truncate text-xs text-secondary">{quote.name}</p>
        </div>
        <div className="text-right">
          <p className="tabular-nums text-primary">{formatPrice(quote.price, quote.digits)}</p>
          <PriceChange value={quote.changePercent} className="text-xs" />
        </div>
      </Link>
    </li>
  );
}

function DesktopRow({
  quote,
  categoryLabel,
  tradeLabel,
}: {
  quote: Quote;
  categoryLabel: string;
  tradeLabel: string;
}) {
  const flash = usePriceFlash(quote.price);
  return (
    <tr
      className={cn(
        'transition-colors duration-500 hover:bg-elevated/60',
        flash && FLASH_CLASSES[flash],
      )}
    >
      <td className="px-6 py-3.5">
        <Link href={instrumentHref(quote)} className="group block">
          <span className="font-medium text-primary group-hover:text-accent">{quote.symbol}</span>
          <span className="block text-xs text-secondary">{quote.name}</span>
        </Link>
      </td>
      <td className="px-6 py-3.5 text-secondary">{categoryLabel}</td>
      <td className="px-6 py-3.5 text-right tabular-nums text-primary">
        {formatPrice(quote.price, quote.digits)}
      </td>
      <td className="px-6 py-3.5 text-right">
        <PriceChange value={quote.changePercent} />
      </td>
      <td className="px-6 py-3.5 text-right">
        <Link href={instrumentHref(quote)}>
          <Button variant="secondary" size="sm" tabIndex={-1}>
            {tradeLabel}
          </Button>
        </Link>
      </td>
    </tr>
  );
}
