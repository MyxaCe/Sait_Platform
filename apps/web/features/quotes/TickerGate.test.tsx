import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TickerGate } from './TickerGate';

/**
 * WEB-38 · шлюз ДОВОДИТ причину до ленты.
 *
 * **Зачем отдельно от проверок ленты.** Те передают причину пропом
 * сами — и остаются зелёными, даже если шлюз её не передаёт. Мутация
 * «убрать `unavailableReasons` из вызова» не покрасила ни одной из
 * пятидесяти четырёх: правило верное, а того, что его зовут, ничто не
 * доказывало. Это место, где у меня дыра появляется чаще всего,
 * поэтому закрыто проверкой самого шлюза.
 */

const answers = {
  // `allowed`, а не `available`: у границы доступа свой перечень.
  '/api/tenant/access': { state: 'allowed', symbols: ['BTCUSD'] },
  '/api/quotes/catalog': { state: 'available', symbols: ['BTCUSD'] },
  '/api/quotes/state': {
    unavailable: [{ symbol: 'BTCUSD', reason: 'source-disabled' }],
    missing: [],
  },
};

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

vi.mock('@broker/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@broker/realtime')>();
  return {
    ...actual,
    useQuoteViews: (symbols: string[]) =>
      symbols.map((symbol) => ({
        quote: {
          symbol,
          name: symbol,
          category: 'crypto',
          price: 65000,
          digits: 0,
          changePercent: null,
          bid: null,
          ask: null,
          ts: 0,
        },
        state: 'unavailable',
      })),
    useConnectionStatus: () => 'connected',
  };
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(answers[url as keyof typeof answers] ?? {}),
      }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

const props = {
  candidates: ['BTCUSD'],
  emptyText: 'emptyText',
  unavailableText: 'unavailableText',
  quotesUnavailableText: 'quotesUnavailableText',
  quotesEmptyText: 'quotesEmptyText',
};

describe('WEB-38 · причина доходит от ручки до разметки', () => {
  it('источник назвал причину → она видна человеку', async () => {
    render(<TickerGate {...props} />);

    // Весь путь: ответ ручки → карта причин → лента → подпись.
    await waitFor(() => expect(screen.getAllByText('shortLimited').length).toBeGreaterThan(0));
  });

  it('полная фраза доезжает тем же путём', async () => {
    render(<TickerGate {...props} />);

    await waitFor(() => {
      const [dash] = screen.getAllByText('—');
      expect(dash?.getAttribute('title')).toBe('sourceDisabled');
    });
  });
});
