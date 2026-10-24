'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Отслеживает направление последнего изменения цены и возвращает
 * 'up' | 'down' на ~600 мс — для короткой цветовой вспышки в строке таблицы.
 *
 * **`null` — цены нет** (настоящего чтения ещё не было). Вспышки при
 * этом не бывает, и отдельно — её не бывает на ПОЯВЛЕНИИ цены (WEB-17).
 * Переход «неизвестно → 65000» не движение, а приход сведений;
 * зелёная вспышка на нём утверждала бы рост, которого никто не
 * наблюдал. Ровно тот же класс, что и сама подставленная цена, только
 * выраженный цветом, а не цифрой.
 */
export function usePriceFlash(price: number | null): 'up' | 'down' | null {
  const prev = useRef(price);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (price === prev.current) return;
    // Появление или исчезновение цены — не движение.
    if (price === null || prev.current === null) {
      prev.current = price;
      return;
    }
    setFlash(price > prev.current ? 'up' : 'down');
    prev.current = price;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [price]);

  return flash;
}
