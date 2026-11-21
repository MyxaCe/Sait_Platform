import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Quote } from '@broker/realtime';
import { LiveQuotePanel } from './LiveQuotePanel';

const feed = vi.hoisted(() => ({ quotes: [] as unknown[], status: 'connected' as string }));

vi.mock('@broker/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@broker/realtime')>();
  return {
    ...actual,
    useRealtimeQuotes: () => feed.quotes,
    useConnectionStatus: () => feed.status,
  };
});

vi.mock('next-intl', () => ({ useLocale: () => 'ru',
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${ns}.${key}:${JSON.stringify(values)}` : `${ns}.${key}`,
}));

const quote = (over: Partial<Quote> = {}): Quote => ({
  symbol: 'EURUSD',
  name: 'Euro / US Dollar',
  category: 'forex',
  price: 1.0841,
  digits: 5,
  changePercent: 0.12,
  bid: 1.08405,
  ask: 1.08415,
  ts: 1_700_000_000_000,
  ...over,
});

const props = {
  symbol: 'EURUSD',
  tradeHref: 'https://cabinet.test/en/terminal?account=real&symbol=EURUSD',
  demoHref: 'https://cabinet.test/en/terminal?account=demo&symbol=EURUSD',
};

describe('панель инструмента · кнопки', () => {
  it('«Торговать» ведёт на реальный счёт, «Попробовать на демо» — на демо, с символом', () => {
    feed.quotes = [];
    render(<LiveQuotePanel {...props} />);

    expect(screen.getByTestId('trade-real').getAttribute('href')).toBe(props.tradeHref);
    expect(screen.getByTestId('trade-demo').getAttribute('href')).toBe(props.demoHref);
    expect(screen.getByTestId('trade-real').textContent).toContain('"symbol":"EURUSD"');
  });
});

describe('панель инструмента · нет живой цены', () => {
  it('причины нет → видно «нет данных»', () => {
    feed.quotes = [];
    render(<LiveQuotePanel {...props} />);

    expect(screen.getByTestId('quote-unavailable').textContent).toBe('connection.noData');
  });

  it('MDS назвал причину → видна причина, а не общее «нет данных»', () => {
    feed.quotes = [];
    render(<LiveQuotePanel {...props} unavailableReason="source-silent" />);

    expect(screen.getByTestId('quote-unavailable').textContent).toBe('instrumentUnavailable.sourceSilent');
  });

  it('рынок закрыт, последняя цена есть → цена видна, рядом «Рынок закрыт»', () => {
    feed.quotes = [quote({ ts: Date.now() - 3_600_000 })];
    render(<LiveQuotePanel {...props} unavailableReason="market-closed" />);

    const why = screen.getByTestId('quote-unavailable');
    expect(why.textContent).toBe('instrumentUnavailable.marketClosed');
    expect(why.getAttribute('data-reason')).toBe('market-closed');
    expect(screen.getByTestId('quote-price').textContent).toMatch(/1[.,]08410/);
  });

  it('торги приостановлены → своя подпись', () => {
    feed.quotes = [];
    render(<LiveQuotePanel {...props} unavailableReason="market-halted" />);

    expect(screen.getByTestId('quote-unavailable').textContent).toBe('instrumentUnavailable.marketHalted');
  });

  it('свежий тик после открытия страницы снимает «Рынок закрыт»', () => {
    feed.quotes = [quote({ ts: Date.now() + 1_000 })];
    render(<LiveQuotePanel {...props} unavailableReason="market-closed" />);

    expect(screen.queryByTestId('quote-unavailable')).toBeNull();
  });

  it('причина не про рынок при живой цене не показывается', () => {
    feed.quotes = [quote()];
    render(<LiveQuotePanel {...props} unavailableReason="stale" />);

    expect(screen.queryByTestId('quote-unavailable')).toBeNull();
    expect(screen.getByTestId('quote-bid').textContent).toMatch(/1[.,]08405/);
    expect(screen.getByTestId('quote-ask').textContent).toMatch(/1[.,]08415/);
  });
});

describe('панель инструмента · закрытый рынок из потока', () => {
  it('котировка с market.closed и nextOpen → цена не погашена, «откроется …»', async () => {
    feed.quotes = [quote({ ts: Date.now() - 3_600_000, market: { status: 'closed', reason: 'weekend', nextOpen: Date.UTC(2026, 10, 23, 22, 0) } })];
    render(<LiveQuotePanel {...props} />);

    const note = await screen.findByText(/instrumentUnavailable\.marketClosedUntil/);
    expect(note.textContent).toContain('"time"');
    expect(screen.getByTestId('quote-price').className).not.toContain('opacity-50');
  });

  it('сервер сказал «закрыт», а поток прислал market.open → пометки нет', () => {
    feed.quotes = [quote({ ts: Date.now() - 3_600_000, market: { status: 'open', reason: null, nextOpen: null } })];
    render(<LiveQuotePanel {...props} market={{ status: 'closed', reason: null, nextOpen: null }} />);

    expect(screen.queryByTestId('quote-unavailable')).toBeNull();
  });
});
