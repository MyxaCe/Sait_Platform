'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Опрос раз в N секунд (дизайн §2-A: для демо — честный опрос, следующий шаг —
 * SSE). Перечитывает серверные компоненты страницы; состояние полей ввода
 * сохраняется (React не пересоздаёт клиентские компоненты). На скрытой
 * вкладке не опрашивает.
 */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
