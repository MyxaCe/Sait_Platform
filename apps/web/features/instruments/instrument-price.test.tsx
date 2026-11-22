import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Quote } from '@broker/realtime';
import { InstrumentsBrowser } from './InstrumentsBrowser';
import { LiveQuotePanel } from './LiveQuotePanel';

const SEED_PRICE = 67450;

const panelProps = {
  symbol: 'BTCUSD',
  tradeHref: 'https://cabinet.test/terminal?account=real&symbol=BTCUSD',
  demoHref: 'https://cabinet.test/terminal?account=demo&symbol=BTCUSD',
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

vi.mock('next-intl', () => ({ useLocale: () => 'ru', useTranslations: () => (key: string) => key }));
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

    render(<LiveQuotePanel {...panelProps} />);

    expect(valueUnder('Bid')).toBe('—');
    expect(valueUnder('Ask')).toBe('—');
    expectNoSeedPrice();
  });

  it('снимок без настоящего чтения → то же самое', () => {
    feed.quotes = [quote({ ts: 0 })];

    render(<LiveQuotePanel {...panelProps} />);

    expect(valueUnder('Bid')).toBe('—');
    expect(valueUnder('Ask')).toBe('—');
    expectNoSeedPrice();
  });

  it('bid и ask — из котировки фида, а не из цены', () => {
    feed.quotes = [quote({ ts: 1_700_000_000_000, price: 68100, bid: 68042, ask: 68157, changePercent: 1.2 })];

    render(<LiveQuotePanel {...panelProps} />);

    expect(valueUnder('Bid')).toMatch(/^68[\s,.  ]?042$/);
    expect(valueUnder('Ask')).toMatch(/^68[\s,.  ]?157$/);
    expect(screen.queryAllByText('—')).toEqual([]);
    expectNoSeedPrice();
  });

  it('цена есть, а bid и ask источник не дал → прочерки, не расчёт', () => {
    feed.quotes = [quote({ ts: 1_700_000_000_000, price: 68100, bid: null, ask: null })];

    render(<LiveQuotePanel {...panelProps} />);

    expect(valueUnder('Bid')).toBe('—');
    expect(valueUnder('Ask')).toBe('—');
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
