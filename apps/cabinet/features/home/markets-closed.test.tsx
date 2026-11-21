import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Quote } from '@broker/realtime';
import { MarketsModule } from './MarketsModule';

const feed = vi.hoisted(() => ({ quotes: [] as unknown[] }));

vi.mock('@broker/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@broker/realtime')>();
  return { ...actual, useRealtimeQuotes: () => feed.quotes };
});
vi.mock('next-intl', () => ({
  useLocale: () => 'ru',
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.keys(values).join(',')}` : key,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

const config = {
  type: 'markets' as const,
  enabled: true,
  tabs: { assets: true, popular: false, newListing: false, favorites: false, gainers: false, volume: false },
  newListingSymbols: [],
};

const quote = (over: Partial<Quote>): Quote => ({
  symbol: 'EURUSD',
  name: 'Euro / US Dollar',
  category: 'forex',
  price: 1.08412,
  digits: 5,
  changePercent: -0.1,
  bid: 1.0841,
  ask: 1.08414,
  ts: 1_795_000_000_000,
  ...over,
});

const data = { state: 'ok' as const, instruments: [{ symbol: 'EURUSD', name: 'Euro / US Dollar', digits: 5, icon: null }] };

describe('«Рынки» кабинета · закрытый рынок', () => {
  it('последняя цена видна, под ней «Рынок закрыт · откроется …»', async () => {
    feed.quotes = [quote({ market: { status: 'closed', reason: 'weekend', nextOpen: 1_795_284_000_000 } })];
    render(<MarketsModule config={config} data={data} />);

    expect(screen.getByText('1.08412')).toBeTruthy();
    const note = await screen.findByText('marketClosedUntil:time');
    expect(note.getAttribute('data-market')).toBe('closed');
  });

  it('торги приостановлены', () => {
    feed.quotes = [quote({ market: { status: 'halted', reason: null, nextOpen: null } })];
    render(<MarketsModule config={config} data={data} />);

    expect(screen.getByText('marketHalted')).toBeTruthy();
  });

  it('рынок открыт — пометки нет', () => {
    feed.quotes = [quote({ market: { status: 'open', reason: null, nextOpen: null } })];
    render(<MarketsModule config={config} data={data} />);

    expect(document.querySelector('[data-market]')).toBeNull();
  });
});
