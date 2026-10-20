'use client';

import { useEffect, useState } from 'react';
import { AccessNotice } from '@/features/instruments/AccessNotice';
import { QuotesTicker } from '@/features/quotes/QuotesTicker';
import {
  decideTicker,
  type TickerAccess,
  type TickerCatalog,
} from '@/features/quotes/ticker-decision';

/**
 * Рантаймовый островок бегущей строки витрины (WEB-07 + WEB-08).
 *
 * **Зачем он вообще есть.** Строка тикера стоит в общем макете, то есть
 * на всех страницах витрины, и макет рендерится на сборке. Всё, что он
 * там спросит у окружения, замёрзнет в готовой разметке: так витрина
 * сообщала поломку там, где её не было (WEB-07, граница доступа), и так
 * же подставляла зашитый список символов вместо каталога MDS (WEB-08,
 * Р-050). Спрашивать то и другое рантайм-вызовом прямо из макета тоже
 * нельзя — это увело бы в динамику всю витрину, а она остаётся
 * редакционной границей (Р-030, п. 2). Поэтому оба вопроса уехали в
 * браузер, а отвечают на них динамические ручки, читающие окружение
 * контейнера.
 *
 * **Два вопроса — две ручки, и это не экономия на запросах.** Граница
 * доступа и каталог котировок отказывают независимо и чинятся разными
 * людьми. Один ответ на оба склеил бы причины в один счётчик — ровно
 * то, из-за чего «версия неустановима» показывала 19 вместо 0, 19 и 18.
 *
 * **Fail-closed сохранён, и это главное.** Пока ответа нет — строки нет:
 * «ещё не знаем» отличается от «знаем, что разрешено», и первое не имеет
 * права выглядеть вторым. Ответ не пришёл вовсе — это `unavailable`, а
 * не «покажем всё».
 *
 * **Чего здесь нет.** Решения. Граница живёт в `@broker/tenant`, сведение
 * трёх источников — в `decideTicker`, сюда приезжает готовый вердикт.
 * Тексты приходят пропсами (ADR-012): компонент не знает ни локали, ни
 * причины — только как это выглядит.
 */

export interface TickerGateProps {
  /**
   * Инструменты страницы из CMS. Редакционный контент, посчитанный на
   * сборке законно. Рантаймовые ответы применяются к ним пересечением,
   * а не заменой.
   */
  candidates: string[];
  /** Подпись при `empty` границы доступа — список получен и пуст. */
  emptyText: string;
  /** Подпись при `unavailable` границы доступа — списка нет либо он протух. */
  unavailableText: string;
  /** Подпись, когда каталог MDS не получен: цен нет и выдумывать нечего. */
  quotesUnavailableText: string;
  /** Подпись, когда оба ответа есть, а пересечение пусто. */
  quotesEmptyText: string;
}

/**
 * Состояний три, и «ещё не спрашивали» — полноценное третье.
 * Непрочитанное выдаётся за отсутствующее ровно тогда, когда его
 * сливают с одним из двух остальных.
 */
/**
 * Третий вопрос — состояние котировок по символам (WEB-12, Р-074).
 *
 * Отдельная ручка по той же причине, по которой каталог отделён от
 * границы доступа: три ответа отказывают независимо и чинятся разными
 * людьми. От каталога он отделён ещё и сроком годности — каталог
 * кешируется на 300 с, состояние котировок кешировать нельзя вовсе.
 *
 * **Ленту он не закрывает, и это сознательно.** Граница доступа и каталог
 * решают, какие символы показывать вообще; этот ответ решает, каким из
 * показанных нельзя верить. Не смогли спросить — значит про отдельные
 * символы ничего не знаем, и вердикт даёт `quoteState` по тому, что у
 * него есть. Закрыть ленту целиком из-за недоступности ЭТОГО ответа
 * значило бы отказать шире заданного вопроса.
 */
interface QuotesAnswer {
  unavailable: { symbol?: unknown }[];
  missing: unknown[];
}

type Answers = { access: TickerAccess; catalog: TickerCatalog; quotes: QuotesAnswer };
type GateState = { kind: 'pending' } | { kind: 'answered'; answers: Answers };

/**
 * Не смогли спросить — значит не знаем. Это `unavailable` с причиной
 * `network`, а не открытая граница и не пустой список.
 */
async function ask<T>(url: string, onFailure: T, signal: AbortSignal): Promise<T> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (error) {
    if (signal.aborted) throw error;
    console.error(`[ticker] ${url} не ответил — строка закрыта`, error);
    return onFailure;
  }
}

export function TickerGate({
  candidates,
  emptyText,
  unavailableText,
  quotesUnavailableText,
  quotesEmptyText,
}: TickerGateProps) {
  const [gate, setGate] = useState<GateState>({ kind: 'pending' });

  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;

    Promise.all([
      ask<TickerAccess>(
        '/api/tenant/access',
        { state: 'unavailable', reason: 'network', symbols: [] },
        signal,
      ),
      ask<TickerCatalog>(
        '/api/quotes/catalog',
        { state: 'unavailable', reason: 'network', symbols: [] },
        signal,
      ),
      // Не ответила — пустые списки. Это «ничего не знаем про отдельные
      // символы», а не «все свежи»: вердикт всё равно остаётся за
      // `quoteState`, который без списка судит по тому, что видит сам.
      ask<QuotesAnswer>('/api/quotes/state', { unavailable: [], missing: [] }, signal),
    ])
      .then(([access, catalog, quotes]) =>
        setGate({ kind: 'answered', answers: { access, catalog, quotes } }),
      )
      .catch(() => {
        /* отменён размонтированием — состояние трогать уже нельзя */
      });

    return () => abort.abort();
  }, []);

  // Ответов ещё нет: ни строки, ни объяснения. Объяснять пока нечего, а
  // строка здесь была бы утверждением, которого состояние не знает.
  if (gate.kind === 'pending') return null;

  const decision = decideTicker(candidates, gate.answers.access, gate.answers.catalog);

  if (decision.kind === 'ticker') {
    // `missing[]` входит наравне с `unavailable[]`: «источник не сказал о
    // символе ничего» — это тоже «цены нет».
    const stale = new Set<string>([
      ...gate.answers.quotes.unavailable
        .map((u) => u.symbol)
        .filter((s): s is string => typeof s === 'string' && s.length > 0),
      ...gate.answers.quotes.missing.filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      ),
    ]);

    return <QuotesTicker symbols={decision.symbols} staleSymbols={stale} />;
  }

  // Какая из двух границ закрылась, видно по машинной причине: у
  // каталога котировок она с префиксом `quotes:`.
  const fromQuotes = decision.reason.startsWith('quotes:');
  const text = fromQuotes
    ? decision.state === 'empty'
      ? quotesEmptyText
      : quotesUnavailableText
    : decision.state === 'empty'
      ? emptyText
      : unavailableText;

  return (
    <AccessNotice
      variant="strip"
      state={decision.state}
      text={text}
      reason={decision.reason}
    />
  );
}
