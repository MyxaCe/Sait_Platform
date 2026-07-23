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
});
