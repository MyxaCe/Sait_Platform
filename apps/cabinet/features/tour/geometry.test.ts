import { describe, expect, it } from 'vitest';
import { highlightBox, nextAvailable, placeCard, stepLabel } from './geometry';

const vp = { width: 1280, height: 800 };

describe('геометрия подсказки', () => {
  it('рамка с отступом не выходит за экран', () => {
    expect(highlightBox({ top: 2, left: 2, width: 100, height: 40 }, vp)).toEqual({ top: 0, left: 0, width: 108, height: 48 });
  });
  it('телефон — нижняя панель', () => {
    expect(placeCard({ top: 100, left: 10, width: 50, height: 50 }, { width: 360, height: 640 }, 200)).toEqual({ mode: 'sheet' });
  });
  it('компьютер: снизу, если влезает; иначе сверху; прижата к краю', () => {
    expect(placeCard({ top: 100, left: 1200, width: 50, height: 40 }, vp, 180)).toEqual({ mode: 'float', top: 158, left: 928, side: 'below' });
    expect(placeCard({ top: 650, left: 10, width: 50, height: 40 }, vp, 180)).toEqual({ mode: 'float', top: 452, left: 12, side: 'above' });
  });
  it('шаги без элемента пропускаются в обе стороны', () => {
    const has = (i: number) => i === 0 || i === 3;
    expect(nextAvailable(1, 1, 5, has)).toBe(3);
    expect(nextAvailable(2, -1, 5, has)).toBe(0);
    expect(nextAvailable(4, 1, 5, has)).toBe(-1);
  });
  it('счётчик шагов', () => {
    expect(stepLabel('Шаг {current} из {total}', 2, 5)).toBe('Шаг 2 из 5');
  });
});
