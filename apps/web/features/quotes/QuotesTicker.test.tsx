import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Quote } from '@broker/realtime';
import { QuotesTicker } from './QuotesTicker';

/**
 * WEB-16 · первая компонентная проверка витрины, и взята она не наугад.
 *
 * Это то же утверждение, что уже охранял `ticker-price-wiring.test.ts`
 * по тексту программы: лента обязана звать общее правило `displayPrice`,
 * а не форматировать цену сама. Проверка по тексту стояла там **за
 * неимением другой** — наблюдаемое следствие у дефекта есть, и очень
 * заметное: вместо прочерка посетитель видит зашитую базовую цену
 * справочника, погашенную и подписанную «последняя известная». Это хуже
 * пустоты: утверждение «цена такая была», которого не было.
 *
 * Теперь то же самое проверяется **по разметке**, и проверка переживает
 * любую перепись компонента: важно, что видно, а не как написано.
 *
 * **Подменены только источники данных.** Хуки фида и переводы — да;
 * `displayPrice` остаётся настоящим, иначе проверялась бы подделка.
 * Ровно этот разрыв — «правило исправно, но его не зовут» — здесь и
 * ловится.
 */

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

/**
 * Первый из найденных узлов. Лента дублирует список ради бесшовной
 * прокрутки, поэтому совпадений всегда несколько; пустота здесь —
 * отказ, и названный, а не `undefined`, уехавший в следующую строку.
 */
function first(nodes: HTMLElement[], what: string): HTMLElement {
  const [node] = nodes;
  if (!node) throw new Error(`в разметке нет ни одного узла: ${what}`);
  return node;
}

const views = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('@broker/realtime', async (importOriginal) => {
  // `displayPrice` настоящий: он и есть предмет проверки.
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

    // `getAllBy`, а не `getBy`: лента дублирует список ради бесшовной
    // прокрутки, и единственность здесь не утверждается.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Зашитая базовая цена не должна попасть в разметку ни в каком виде.
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
