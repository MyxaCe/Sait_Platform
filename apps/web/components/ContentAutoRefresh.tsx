'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const POLL_INTERVAL_MS = 10_000;

/**
 * Автообновление контента открытой страницы после публикации в CMS.
 *
 * Раз в POLL_INTERVAL_MS сравнивает метку `rendered-at` (ADR-020) текущей
 * ISR-версии страницы с последней увиденной; изменилась → router.refresh():
 * серверные компоненты перезапрашиваются на месте, без перезагрузки и потери
 * состояния (скролл, формы, WS-подписки котировок не рвутся).
 *
 * Вкладка в фоне не опрашивает (visibility). В draft-режиме выключен:
 * preview рендерится динамически и метка меняется на каждый запрос.
 */
export function ContentAutoRefresh({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  // Последняя увиденная метка привязана к пути: смена страницы — новый отсчёт
  const lastSeen = useRef<{ path: string; renderedAt: string } | null>(null);

  useEffect(() => {
    if (disabled) return;
    let stopped = false;

    const probe = async () => {
      if (stopped || document.hidden) return;
      const path = window.location.pathname + window.location.search;
      try {
        const res = await fetch(path, {
          headers: { accept: 'text/html' },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const html = await res.text();
        const match =
          html.match(/name="rendered-at"[^>]*content="([^"]+)"/) ??
          html.match(/content="([^"]+)"[^>]*name="rendered-at"/);
        const renderedAt = match?.[1];
        if (!renderedAt) return;

        if (lastSeen.current === null || lastSeen.current.path !== path) {
          lastSeen.current = { path, renderedAt };
          return;
        }
        if (lastSeen.current.renderedAt !== renderedAt) {
          lastSeen.current = { path, renderedAt };
          if (!stopped) router.refresh();
        }
      } catch {
        // сеть недоступна — попробуем на следующем тике
      }
    };

    const id = setInterval(probe, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [disabled, router]);

  return null;
}
