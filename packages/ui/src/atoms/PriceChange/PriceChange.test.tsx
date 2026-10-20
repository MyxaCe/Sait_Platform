import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceChange } from './PriceChange';

describe('PriceChange', () => {
  it('рост — плюс и зелёный цвет', () => {
    render(<PriceChange value={1.234} />);
    const el = screen.getByText('+1.23%');
    expect(el.className).toContain('text-positive');
  });

  it('падение — типографский минус и красный цвет', () => {
    render(<PriceChange value={-0.87} />);
    const el = screen.getByText('−0.87%');
    expect(el.className).toContain('text-negative');
  });

  it('около нуля — нейтральный цвет без стрелки', () => {
    const { container } = render(<PriceChange value={0.001} />);
    expect(screen.getByText('0.00%').className).toContain('text-secondary');
    expect(container.querySelector('svg')).toBeNull();
  });

  describe('изменение неизвестно (null)', () => {
    it('прочерк вместо процентов, без цвета и без стрелки', () => {
      const { container } = render(<PriceChange value={null} />);

      const el = screen.getByText('—');
      expect(el.className).not.toContain('text-positive');
      expect(el.className).not.toContain('text-negative');
      expect(container.querySelector('svg')).toBeNull();
    });

    it('не выводит «0.00%» — это утверждение «цена не изменилась»', () => {
      // Поведение до правки: обе проверки порога для null ложны, а
      // `Math.abs(null)` даёт 0 — на экране появлялось уверенное «0.00%».
      render(<PriceChange value={null} />);

      expect(screen.queryByText(/%/)).toBeNull();
    });

    it('отличимо от настоящего нуля — иначе третье состояние незаметно', () => {
      // Главное свойство задачи. «Цена не изменилась» и «изменение
      // неизвестно» — разные утверждения, и посетитель должен видеть разное.
      // Пока они рисуются одинаково, MDS обнулять поле небезопасно.
      const empty = render(<PriceChange value={null} />).container.textContent;
      const zero = render(<PriceChange value={0} />).container.textContent;

      expect(empty).not.toBe(zero);
    });

    it('прочерк подписан словами — screen reader читает причину, а не тире', () => {
      render(<PriceChange value={null} noDataLabel="нет данных" />);

      expect(screen.getByLabelText('нет данных')).toBeTruthy();
    });
  });
});
