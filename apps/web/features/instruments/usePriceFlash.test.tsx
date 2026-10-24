import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePriceFlash } from './usePriceFlash';

/**
 * WEB-17 · вспышка цены не утверждает движения, которого не было.
 *
 * Вспышка — это цвет, а не цифра, и потому её легко не причислить к
 * тому же классу. Но зелёное мигание на переходе «цены не было →
 * 68100» говорит ровно то же, что подставленное число: цена выросла.
 * Никто этого не наблюдал — пришли первые сведения.
 *
 * Обратный переход, «цена была → пропала», тем более не падение.
 */

describe('usePriceFlash · появление цены не движение', () => {
  it('неизвестно → цена: вспышки нет', () => {
    const { result, rerender } = renderHook(({ p }) => usePriceFlash(p), {
      initialProps: { p: null as number | null },
    });

    act(() => rerender({ p: 68100 }));

    expect(result.current).toBeNull();
  });

  it('цена → неизвестно: вспышки нет', () => {
    const { result, rerender } = renderHook(({ p }) => usePriceFlash(p), {
      initialProps: { p: 68100 as number | null },
    });

    act(() => rerender({ p: null }));

    expect(result.current).toBeNull();
  });

  it('настоящее движение вверх вспышку даёт — иначе проверка пуста', () => {
    const { result, rerender } = renderHook(({ p }) => usePriceFlash(p), {
      initialProps: { p: 68100 as number | null },
    });

    act(() => rerender({ p: 68200 }));

    expect(result.current).toBe('up');
  });

  it('настоящее движение вниз тоже', () => {
    const { result, rerender } = renderHook(({ p }) => usePriceFlash(p), {
      initialProps: { p: 68100 as number | null },
    });

    act(() => rerender({ p: 68000 }));

    expect(result.current).toBe('down');
  });

  it('первая настоящая цена после появления движется как обычно', () => {
    // Появление не вспыхивает, но следующий тик — уже движение.
    const { result, rerender } = renderHook(({ p }) => usePriceFlash(p), {
      initialProps: { p: null as number | null },
    });

    act(() => rerender({ p: 68100 }));
    expect(result.current).toBeNull();

    act(() => rerender({ p: 68200 }));
    expect(result.current).toBe('up');
  });
});
