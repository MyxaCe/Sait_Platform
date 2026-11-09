'use client';

import { useEffect, useState } from 'react';
import { ConnectionDot, type ConnectionState } from '@broker/ui';

/**
 * Индикатор здоровья платформы (§2.1, §4.1). Опрашивает единственный публичный
 * роут `/api/health` (он и есть liveness-проба гейта) и переводит ответ в
 * `ConnectionDot`. Первое, что видит оператор: закрывается ли периметр.
 *
 * Fail-closed в показе: любая ошибка/не-200 → «нет связи», а не молчаливое
 * «вроде ок». Пустой/недостижимый health читаем как offline.
 */
const LABELS: Record<Exclude<ConnectionState, 'reconnecting' | 'simulated'>, string> = {
  connecting: 'Проверка…',
  connected: 'Платформа в норме',
  offline: 'Нет связи с платформой',
};

export function HealthIndicator({ variant = 'dot' }: { variant?: 'dot' | 'tile' }) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');

  useEffect(() => {
    let alive = true;

    async function probe() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const body = (await res.json()) as { status?: string };
        if (!alive) return;
        setStatus(res.ok && body.status === 'ok' ? 'connected' : 'offline');
      } catch {
        if (alive) setStatus('offline');
      }
    }

    probe();
    const id = setInterval(probe, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const label = LABELS[status];

  if (variant === 'tile') {
    return (
      <span className="text-primary flex items-center gap-2 text-[15px] font-medium">
        <ConnectionDot status={status} label={label} />
        {label}
      </span>
    );
  }

  return (
    <span className="text-secondary flex items-center gap-2 text-sm">
      <ConnectionDot status={status} label={label} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
