'use client';

import { useEffect, useState } from 'react';
import { AccessNotice } from '@/features/instruments/AccessNotice';
import { QuotesTicker } from '@/features/quotes/QuotesTicker';

/**
 * Рантаймовый островок границы доступа в общем макете витрины (WEB-07).
 *
 * **Зачем он вообще есть.** Строка тикера стоит на всех 156 страницах, и
 * раньше макет спрашивал границу прямо в серверном рендере. На сборке
 * `CMS_API_URL` нет — и ответ «не настроено» замерзал в готовой разметке
 * каждой страницы: витрина сообщала поломку там, где её не было.
 * Спросить границу в рантайме прямо из макета тоже нельзя — это увело бы
 * в динамику всю витрину, а она остаётся редакционной границей
 * (Р-030, п. 2). Поэтому вопрос уехал в браузер, ответ даёт
 * `GET /api/tenant/access`, и диагноз считается из окружения контейнера.
 *
 * **Fail-closed сохранён, и это главное.** Пока ответа нет — тикера нет:
 * «ещё не знаем» отличается от «знаем, что разрешено», и первое не имеет
 * права выглядеть вторым. Ответ не пришёл вовсе — это `unavailable`, а
 * не «покажем всё»: отказ инфраструктуры, превращённый в разрешение, —
 * худший исход для регуляторного фильтра.
 *
 * **Что здесь НЕ решается.** Решение о доступе по-прежнему целиком в
 * `@broker/tenant` на сервере; сюда приезжает готовый вердикт. Клиент
 * только показывает. Отбор символов страницы и деталки остаётся
 * серверным — там граница фильтрует содержимое, а не оформление.
 *
 * Тексты приходят пропсами (ADR-012): компонент не знает ни локали, ни
 * причины — только как это выглядит.
 */

interface AccessResponse {
  state: 'allowed' | 'empty' | 'unavailable';
  reason?: string;
  symbols: string[];
}

export interface TickerGateProps {
  /**
   * Символы, посчитанные статически: контент CMS ∩ каталог MDS. Границу
   * к ним применяет уже рантаймовый ответ — пересечением, а не заменой.
   */
  candidates: string[];
  /** Подпись строки при `empty` — список получен и пуст. */
  emptyText: string;
  /** Подпись строки при `unavailable` — списка нет либо он протух. */
  unavailableText: string;
}

/**
 * Состояний три, и «ещё не спрашивали» — полноценное третье.
 * Непрочитанное выдаётся за отсутствующее ровно тогда, когда его
 * сливают с одним из двух остальных.
 */
type GateState = { kind: 'pending' } | { kind: 'answered'; access: AccessResponse };

export function TickerGate({ candidates, emptyText, unavailableText }: TickerGateProps) {
  const [gate, setGate] = useState<GateState>({ kind: 'pending' });

  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/tenant/access', { cache: 'no-store', signal: abort.signal })
      .then((res) => (res.ok ? (res.json() as Promise<AccessResponse>) : Promise.reject(res.status)))
      .then((access) => setGate({ kind: 'answered', access }))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        // Не смогли спросить — значит не знаем. Это `unavailable` с
        // причиной `network`, а не открытая граница и не пустой список.
        console.error('[tenant] граница доступа не отвечает — строка закрыта', error);
        setGate({ kind: 'answered', access: { state: 'unavailable', reason: 'network', symbols: [] } });
      });
    return () => abort.abort();
  }, []);

  // Ответа ещё нет: ни тикера, ни объяснения. Объяснять пока нечего, а
  // тикер здесь был бы утверждением, которого состояние не знает.
  if (gate.kind === 'pending') return null;

  const { access } = gate;

  if (access.state === 'allowed') {
    const allowed = new Set(access.symbols);
    return <QuotesTicker symbols={candidates.filter((s) => allowed.has(s))} />;
  }

  return (
    <AccessNotice
      variant="strip"
      state={access.state}
      text={access.state === 'empty' ? emptyText : unavailableText}
      reason={access.reason}
    />
  );
}
