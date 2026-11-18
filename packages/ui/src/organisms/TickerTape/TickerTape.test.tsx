import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TickerTape } from './TickerTape';

const ITEMS = [{ symbol: 'EURUSD', price: '1.0842', changePercent: 0.12 }];

describe('TickerTape · признак ненастоящих данных', () => {
  it('simulated — подпись видна текстом, а не только тултипом', () => {
    render(<TickerTape items={ITEMS} status="simulated" connectionLabel="Демо-данные" />);
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
  it('unavailable с настоящим чтением — цена ГАСИТСЯ и помечается, а не стирается', () => {
    render(
      <TickerTape
        items={[{ symbol: 'EURUSD', price: '1.0842', changePercent: 0.12, state: 'unavailable' }]}
        status="connected"
        noDataLabel="нет данных"
        lastKnownLabel="последняя известная"
      />,
    );

    const price = screen.getAllByText('1.0842')[0];
    expect(price).toBeTruthy();
    expect(price?.className).toContain('opacity-50');
    expect(screen.getAllByText('последняя известная').length).toBeGreaterThan(0);
  });

  it('unavailable без чтения — прочерк: гасить нечего, фикстуру не выдаём', () => {
    render(
      <TickerTape
        items={[{ symbol: 'EURUSD', price: null, changePercent: null, state: 'unavailable' }]}
        status="connected"
        noDataLabel="нет данных"
        lastKnownLabel="последняя известная"
      />,
    );

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByText('нет данных').length).toBeGreaterThan(0);
    expect(screen.queryByText('последняя известная')).toBeNull();
  });

  it('погашенная цена отличима от живой — иначе гашение бессмысленно', () => {
    const dimmed = render(
      <TickerTape
        items={[{ symbol: 'EURUSD', price: '1.0842', changePercent: null, state: 'unavailable' }]}
        status="connected"
      />,
    ).container.querySelector('.opacity-50');

    const live = render(
      <TickerTape
        items={[{ symbol: 'EURUSD', price: '1.0842', changePercent: null, state: 'live' }]}
        status="connected"
      />,
    ).container.querySelector('.opacity-50');

    expect(dimmed).not.toBeNull();
    expect(live).toBeNull();
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
