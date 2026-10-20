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
  it('unavailable с настоящим чтением — цена ГАСИТСЯ и помечается, а не стирается', () => {
    // PKG-06, Р-127. Прежняя редакция стирала число и писала «нет данных».
    // Это заменяло одно правдоподобное утверждение другим: пустая полоса
    // читается как «котировок нет». Прежняя цена была верна на момент
    // последнего успешного чтения — неправдой было бы показать её как
    // ТЕКУЩУЮ, а не показать вовсе (Р-070).
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
    // Погашено: число на экране, но видно, что оно не текущее.
    expect(price?.className).toContain('opacity-50');
    // И помечено словами, а не только прозрачностью: подпись читается и
    // там, где тултипа нет, — это урок B-018.
    expect(screen.getAllByText('последняя известная').length).toBeGreaterThan(0);
  });

  it('unavailable без чтения — прочерк: гасить нечего, фикстуру не выдаём', () => {
    // Граница правила. `price: null` означает, что настоящего чтения ещё не
    // было: в сторе лежит зашитая базовая цена справочника. Погасить её как
    // «последнюю известную» значило бы выдать фикстуру за котировку —
    // ровно тот дефект, который §5г нашёл внутри себя.
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
    // Растяжка: если бы отказ рисовался так же, как норма, единственным
    // различием осталась бы подпись, а её легко не заметить боковым зрением.
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
