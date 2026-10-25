'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  useConnectionStatus,
  useRealtimeQuotes,
  type InstrumentCategory,
  type Quote,
} from '@broker/realtime';
import { Button, ConnectionDot, Input, PriceChange, cn } from '@broker/ui';
import { CATEGORY_ORDER } from './categories';
import { QuotePrice, priceReading } from './QuotePrice';
import { explainUnavailable } from '../quotes/unavailable-text';
import { usePriceFlash } from './usePriceFlash';

type CategoryFilter = InstrumentCategory | 'all';

export interface InstrumentsBrowserProps {
  /** Allow-list символов из CMS — отображаются и подписываются только они */
  symbols: string[];
  /** Символ → URL иконки (CMS-загрузка приоритетнее, иначе монета из MDS) */
  icons?: Record<string, string>;
  /**
   * Символ → машинная причина, по которой у него нет цены (WEB-39).
   *
   * Обычный объект, а не `Map`: проп пересекает границу
   * сервер/клиент, и `Map` приехал бы пустым.
   */
  unavailableReasons?: Record<string, string>;
}

export function InstrumentsBrowser({
  symbols,
  icons = {},
  unavailableReasons = {},
}: InstrumentsBrowserProps) {
  const t = useTranslations('instruments');
  const tCat = useTranslations('categories');
  const tConn = useTranslations('connection');
  const tWhy = useTranslations('instrumentUnavailable');
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

  const quotes = useRealtimeQuotes(symbols);
  const status = useConnectionStatus();

  /*
    Объяснение ставится ТОЛЬКО когда источник назвал причину. Нет
    причины — `undefined`, и строка показывает прежнее общее «нет
    данных»: текст, появившийся там, где объяснять нечего, был бы
    таким же утверждением о незнаемом, как подставленное число.
  */
  const whyFor = (symbol: string): { short: string; full: string } | undefined => {
    const reason = unavailableReasons[symbol];
    if (reason === undefined) return undefined;
    const e = explainUnavailable(reason);
    return {
      short: tWhy(e.family === 'limited' ? 'shortLimited' : 'shortFault'),
      full: tWhy(e.key),
    };
  };

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
          <MobileRow
            key={q.symbol}
            quote={q}
            iconUrl={icons[q.symbol]}
            noDataLabel={tConn('noData')}
            why={whyFor(q.symbol)}
          />
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
              <DesktopRow
                key={q.symbol}
                quote={q}
                iconUrl={icons[q.symbol]}
                categoryLabel={tCat(q.category)}
                tradeLabel={tCommon('trade')}
                noDataLabel={tConn('noData')}
                why={whyFor(q.symbol)}
              />
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

/** Иконка инструмента; без URL — буквенный бейдж (деградация без MDS/CMS). */
function InstrumentIcon({ symbol, iconUrl }: { symbol: string; iconUrl?: string }) {
  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG с MDS, next/image не нужен
      <img
        src={iconUrl}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        className="h-8 w-8 shrink-0 rounded-full"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-secondary"
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

/** Короткая видимая подпись и полная фраза при наведении (WEB-38/39). */
interface UnavailableWhy {
  short: string;
  full: string;
}

function MobileRow({
  quote,
  iconUrl,
  noDataLabel,
  why,
}: {
  quote: Quote;
  iconUrl?: string;
  noDataLabel: string;
  why?: UnavailableWhy;
}) {
  const flash = usePriceFlash(priceReading(quote));
  return (
    <li className={cn('transition-colors duration-500', flash && FLASH_CLASSES[flash])}>
      <Link href={instrumentHref(quote)} className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <InstrumentIcon symbol={quote.symbol} iconUrl={iconUrl} />
          <div className="min-w-0">
            <p className="font-medium text-primary">{quote.symbol}</p>
            <p className="truncate text-xs text-secondary">{quote.name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="tabular-nums text-primary">
            <QuotePrice quote={quote} noDataLabel={why?.full ?? noDataLabel} />
          </p>
          {why && (
            <p className="text-[11px] text-secondary" title={why.full}>
              {why.short}
            </p>
          )}
          <PriceChange value={quote.changePercent} className="text-xs" />
        </div>
      </Link>
    </li>
  );
}

function DesktopRow({
  quote,
  iconUrl,
  categoryLabel,
  tradeLabel,
  noDataLabel,
  why,
}: {
  quote: Quote;
  iconUrl?: string;
  categoryLabel: string;
  tradeLabel: string;
  noDataLabel: string;
  why?: UnavailableWhy;
}) {
  const flash = usePriceFlash(priceReading(quote));
  return (
    <tr
      className={cn(
        'transition-colors duration-500 hover:bg-elevated/60',
        flash && FLASH_CLASSES[flash],
      )}
    >
      <td className="px-6 py-3.5">
        <Link href={instrumentHref(quote)} className="group flex items-center gap-3">
          <InstrumentIcon symbol={quote.symbol} iconUrl={iconUrl} />
          <span>
            <span className="font-medium text-primary group-hover:text-accent">{quote.symbol}</span>
            <span className="block text-xs text-secondary">{quote.name}</span>
          </span>
        </Link>
      </td>
      <td className="px-6 py-3.5 text-secondary">{categoryLabel}</td>
      <td className="px-6 py-3.5 text-right tabular-nums text-primary">
        <QuotePrice quote={quote} noDataLabel={why?.full ?? noDataLabel} />
        {/*
          Видимой строкой, а не только тултипом: тултипа нет на
          сенсорных экранах, и здесь это важнее, чем в ленте, — список
          читают именно с телефона.
        */}
        {why && (
          <span className="block text-[11px] font-normal text-secondary" title={why.full}>
            {why.short}
          </span>
        )}
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
