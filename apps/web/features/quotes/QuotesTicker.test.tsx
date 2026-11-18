import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Quote } from '@broker/realtime';
import { QuotesTicker } from './QuotesTicker';

const quote = (over: Partial<Quote> = {}): Quote =>
  ({
    symbol: 'BTCUSD',
    price: 65000,
    digits: 2,
    changePercent: 1.5,
    category: 'crypto',
    ts: 1_700_000_000_000,
    ...over,
  }) as Quote;

function first(nodes: HTMLElement[], what: string): HTMLElement {
  const [node] = nodes;
  if (!node) throw new Error(`в разметке нет ни одного узла: ${what}`);
  return node;
}

const views = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('@broker/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@broker/realtime')>();
  return {
    ...actual,
    useQuoteViews: () => views.current,
    useConnectionStatus: () => 'live',
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('QuotesTicker · цена, которой не было, не показывается', () => {
  it('настоящего чтения не было (ts = 0) → прочерк, а не цена справочника', () => {
    views.current = [{ quote: quote({ ts: 0 }), state: 'live' }];

    render(<QuotesTicker symbols={['BTCUSD']} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/65[\s,.]?000/)).toEqual([]);
  });

  it('настоящее чтение есть → цена показывается', () => {
    views.current = [{ quote: quote(), state: 'live' }];

    render(<QuotesTicker symbols={['BTCUSD']} />);

    expect(screen.getAllByText(/65[\s,.]?000/).length).toBeGreaterThan(0);
  });

  it('источник объявил символ недоступным → цена гаснет и подписывается', () => {
    views.current = [{ quote: quote(), state: 'unavailable' }];

    render(<QuotesTicker symbols={['BTCUSD']} />);

    const price = first(screen.getAllByText(/65[\s,.]?000/), 'цена 65000');
    expect(price.className).toContain('opacity-50');
    expect(price.getAttribute('title')).toBe('lastKnown');
  });

  it('недоступен И настоящего чтения не было → прочерк, гасить нечего', () => {
    views.current = [{ quote: quote({ ts: 0 }), state: 'unavailable' }];

    render(<QuotesTicker symbols={['BTCUSD']} />);

    const dash = first(screen.getAllByText('—'), 'прочерк');
    expect(dash.getAttribute('title')).toBe('noData');
  });
});

describe('WEB-38 · молчащий инструмент называет себя', () => {
  const reasons = (r: string) => new Map<string, string | null>([['BTCUSD', r]]);

  it('источник выключен → видно «пока не даём», а не просто прочерк', () => {
    views.current = [{ quote: quote({ ts: 0 }), state: 'unavailable' }];

    render(
      <QuotesTicker
        symbols={['BTCUSD']}
        staleSymbols={new Set(['BTCUSD'])}
        unavailableReasons={reasons('source-disabled')}
      />,
    );

    expect(screen.getAllByText('shortLimited').length).toBeGreaterThan(0);
  });

  it('источник молчит → видно «цены нет»: это другое обещание', () => {
    views.current = [{ quote: quote({ ts: 0 }), state: 'unavailable' }];

    render(
      <QuotesTicker
        symbols={['BTCUSD']}
        staleSymbols={new Set(['BTCUSD'])}
        unavailableReasons={reasons('source-silent')}
      />,
    );

    expect(screen.getAllByText('shortFault').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('shortLimited')).toEqual([]);
  });

  it('полная фраза доступна при наведении', () => {
    views.current = [{ quote: quote({ ts: 0 }), state: 'unavailable' }];

    render(
      <QuotesTicker
        symbols={['BTCUSD']}
        staleSymbols={new Set(['BTCUSD'])}
        unavailableReasons={reasons('source-disabled')}
      />,
    );

    const [dash] = screen.getAllByText('—');
    expect(dash?.getAttribute('title')).toBe('sourceDisabled');
  });

  it('ВТОРАЯ СТОРОНА: цена есть → никакого объяснения не появляется', () => {
    views.current = [{ quote: quote(), state: 'live' }];

    render(<QuotesTicker symbols={['BTCUSD']} />);

    expect(screen.queryAllByText('shortLimited')).toEqual([]);
    expect(screen.queryAllByText('shortFault')).toEqual([]);
    expect(screen.queryAllByText('sourceDisabled')).toEqual([]);
  });

  it('цены нет, но причину источник не назвал → прежнее общее «нет данных»', () => {
    views.current = [{ quote: quote({ ts: 0 }), state: 'unavailable' }];

    render(<QuotesTicker symbols={['BTCUSD']} />);

    expect(screen.getAllByText('noData').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('shortLimited')).toEqual([]);
  });
});
