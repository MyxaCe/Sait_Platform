'use client';

import { useEffect, useRef, useState } from 'react';

export function usePriceFlash(price: number | null): 'up' | 'down' | null {
  const prev = useRef(price);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (price === prev.current) return;
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
