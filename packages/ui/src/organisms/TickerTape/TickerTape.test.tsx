import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TickerTape } from './TickerTape';

/**
 * B-018: синтетические цены не имеют права выглядеть рыночными.
 * Требование штаба — разница видна без чтения кода, поэтому проверяется
 * именно ВИДИМЫЙ текст, а не только цвет точки и тултип: тултипа нет на
 * тач-устройствах, а цвет ничего не объясняет тому, кто не знает легенды.
 */
const ITEMS = [{ symbol: 'EURUSD', price: '1.0842', changePercent: 0.12 }];

describe('TickerTape · признак ненастоящих данных', () => {
  it('simulated — подпись видна текстом, а не только тултипом', () => {
    render(<TickerTape items={ITEMS} status="simulated" connectionLabel="Демо-данные" />);
    // getByText ищет по видимому тексту; title/aria-label сюда не попадают
    expect(screen.getByText('Демо-данные')).toBeTruthy();
  });

  it('simulated — точка не зелёная и не пульсирует', () => {
    render(<TickerTape items={ITEMS} status="simulated" />);
    const dot = screen.getByRole('status');
    expect(dot.className).not.toContain('bg-positive');
    expect(dot.className).not.toContain('animate-pulse');
  });

  it('connected — подпись НЕ выводится текстом (лента остаётся чистой)', () => {
    render(
      <TickerTape items={ITEMS} status="connected" connectionLabel="Данные в реальном времени" />,
    );
    expect(screen.queryByText('Данные в реальном времени')).toBeNull();
    expect(screen.getByRole('status').className).toContain('bg-positive');
  });

  it('без connectionLabel simulated всё равно объясняет себя словами', () => {
    render(<TickerTape items={ITEMS} status="simulated" />);
    expect(screen.getByText(/Демо-данные/)).toBeTruthy();
  });
});

describe('TickerTape · данных нет', () => {
  it('unavailable — цена не выводится вовсе, вместо неё прочерк и подпись', () => {
    render(
      <TickerTape
        items={[{ symbol: 'EURUSD', price: '1.0842', changePercent: 0.12, state: 'unavailable' }]}
        status="connected"
        noDataLabel="нет данных"
      />,
    );
    // Последняя известная цена неотличима от текущей — её быть не должно
    expect(screen.queryByText('1.0842')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByText('нет данных').length).toBeGreaterThan(0);
  });

  it('unavailable — процент изменения тоже скрыт (0% читается как «рынок стоит»)', () => {
    render(
      <TickerTape
        items={[{ symbol: 'EURUSD', price: '1.0842', changePercent: 0, state: 'unavailable' }]}
        status="connected"
      />,
    );
    expect(screen.queryByText('0.00%')).toBeNull();
  });

  it('live (и без state) — цена на месте, обратная совместимость сохранена', () => {
    render(
      <TickerTape
        items={[{ symbol: 'EURUSD', price: '1.0842', changePercent: 0.12 }]}
        status="connected"
      />,
    );
    expect(screen.getAllByText('1.0842').length).toBeGreaterThan(0);
  });
});
