import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Quote, SymbolDef } from '@broker/realtime';
import { InstrumentsBrowser } from './InstrumentsBrowser';
import { LiveQuotePanel } from './LiveQuotePanel';

const SEED_PRICE = 67450;

const def: SymbolDef = {
  symbol: 'BTCUSD',
  name: 'Bitcoin',
  category: 'crypto',
  basePrice: SEED_PRICE,
  digits: 0,
  tickVolatility: 0.0012,
};

const quote = (over: Partial<Quote> = {}): Quote =>
  ({
    symbol: 'BTCUSD',
    name: 'Bitcoin',
    category: 'crypto',
    price: SEED_PRICE,
    digits: 0,
    changePercent: null,
    ts: 0,
    ...over,
  }) as Quote;

const feed = vi.hoisted(() => ({ quotes: [] as unknown[] }));

vi.mock('@broker/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@broker/realtime')>();
  return {
    ...actual,
    useRealtimeQuotes: () => feed.quotes,
    useConnectionStatus: () => 'connected',
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

function valueUnder(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.nextElementSibling;
  if (!dd) throw new Error(`под подписью «${label}» нет значения`);
  return (dd.textContent ?? '').trim();
}

function expectNoSeedPrice() {
  const text = (document.body.textContent ?? '').replace(/[\s,  ]/g, '');

  expect(text).not.toContain(String(SEED_PRICE));
}

describe('WEB-17 · обзор инструментов', () => {
  it('настоящего чтения не было → прочерк вместо цены справочника', () => {
    feed.quotes = [quote({ ts: 0 })];

    render(<InstrumentsBrowser symbols={['BTCUSD']} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expectNoSeedPrice();
  });

  it('настоящее чтение есть → цена показывается', () => {
    feed.quotes = [quote({ ts: 1_700_000_000_000, price: 68100 })];

    render(<InstrumentsBrowser symbols={['BTCUSD']} />);

    expect(screen.getAllByText(/68[\s,.]?100/).length).toBeGreaterThan(0);
  });

  it('прочерк назван, а не просто нарисован', () => {
    feed.quotes = [quote({ ts: 0 })];

    render(<InstrumentsBrowser symbols={['BTCUSD']} />);

    const [dash] = screen.getAllByText('—');
    expect(dash?.getAttribute('title')).toBe('noData');
  });
});

describe('WEB-17 · панель инструмента', () => {
  it('котировки нет вовсе → ни цены, ни bid, ни ask', () => {
    feed.quotes = [];

    render(<LiveQuotePanel def={def} />);

    expect(valueUnder('Bid')).toBe('—');
    expect(valueUnder('Ask')).toBe('—');
    expectNoSeedPrice();
  });

  it('снимок без настоящего чтения → то же самое', () => {
    feed.quotes = [quote({ ts: 0 })];

    render(<LiveQuotePanel def={def} />);

    expect(valueUnder('Bid')).toBe('—');
    expect(valueUnder('Ask')).toBe('—');
    expectNoSeedPrice();
  });

  it('настоящее чтение → цена, bid и ask появляются и считаются из живой', () => {
    feed.quotes = [quote({ ts: 1_700_000_000_000, price: 68100, changePercent: 1.2 })];

    render(<LiveQuotePanel def={def} />);

    expect(valueUnder('Bid')).toMatch(/^68[\s,.]?0?\d\d$/);
    expect(valueUnder('Ask')).toMatch(/^68[\s,.]?1\d\d$/);
    expect(screen.queryAllByText('—')).toEqual([]);
    expectNoSeedPrice();
  });
});

describe('WEB-39 · молчащий инструмент в СПИСКЕ называет себя', () => {
  it('источник выключен → видно «пока не даём»', () => {
    feed.quotes = [quote({ ts: 0 })];

    render(
      <InstrumentsBrowser
        symbols={['BTCUSD']}
        unavailableReasons={{ BTCUSD: 'source-disabled' }}
      />,
    );

    expect(screen.getAllByText('shortLimited').length).toBeGreaterThan(0);
  });

  it('источник молчит → видно «цены нет»: другое обещание', () => {
    feed.quotes = [quote({ ts: 0 })];

    render(
      <InstrumentsBrowser symbols={['BTCUSD']} unavailableReasons={{ BTCUSD: 'source-silent' }} />,
    );

    expect(screen.getAllByText('shortFault').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('shortLimited')).toEqual([]);
  });

  it('полная фраза — при наведении', () => {
    feed.quotes = [quote({ ts: 0 })];

    render(
      <InstrumentsBrowser
        symbols={['BTCUSD']}
        unavailableReasons={{ BTCUSD: 'source-disabled' }}
      />,
    );

    const [dash] = screen.getAllByText('—');
    expect(dash?.getAttribute('title')).toBe('sourceDisabled');
  });

  it('ВТОРАЯ СТОРОНА: цена есть → объяснения нет', () => {
    feed.quotes = [quote({ ts: 1_700_000_000_000, price: 68100 })];

    render(<InstrumentsBrowser symbols={['BTCUSD']} unavailableReasons={{}} />);

    expect(screen.queryAllByText('shortLimited')).toEqual([]);
    expect(screen.queryAllByText('shortFault')).toEqual([]);
  });

  it('цены нет, но причину не назвали → прежнее общее «нет данных»', () => {
    feed.quotes = [quote({ ts: 0 })];

    render(<InstrumentsBrowser symbols={['BTCUSD']} />);

    expect(screen.queryAllByText('shortLimited')).toEqual([]);
    expect(screen.queryAllByText('shortFault')).toEqual([]);
    const [dash] = screen.getAllByText('—');
    expect(dash?.getAttribute('title')).toBe('noData');
  });
});
