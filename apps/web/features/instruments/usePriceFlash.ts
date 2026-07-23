'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Отслеживает направление последнего изменения цены и возвращает
 * 'up' | 'down' на ~600 мс — для короткой цветовой вспышки в строке таблицы.
 */
export function usePriceFlash(price: number): 'up' | 'down' | null {
  const prev = useRef(price);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (price === prev.current) return;
    setFlash(price > prev.current ? 'up' : 'down');
    prev.current = price;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [price]);

  return flash;
}
