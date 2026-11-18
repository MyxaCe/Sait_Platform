'use client';

import { useEffect, useState } from 'react';
import { AccessNotice } from '@/features/instruments/AccessNotice';
import { QuotesTicker } from '@/features/quotes/QuotesTicker';
import {
  decideTicker,
  type TickerAccess,
  type TickerCatalog,
} from '@/features/quotes/ticker-decision';

export interface TickerGateProps {
  candidates: string[];
  emptyText: string;
  unavailableText: string;
  quotesUnavailableText: string;
  quotesEmptyText: string;
}

interface QuotesAnswer {
  unavailable: { symbol?: unknown; reason?: unknown; rawReason?: unknown }[];
  missing: unknown[];
}

type Answers = { access: TickerAccess; catalog: TickerCatalog; quotes: QuotesAnswer };
type GateState = { kind: 'pending' } | { kind: 'answered'; answers: Answers };

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
      ask<QuotesAnswer>('/api/quotes/state', { unavailable: [], missing: [] }, signal),
    ])
      .then(([access, catalog, quotes]) =>
        setGate({ kind: 'answered', answers: { access, catalog, quotes } }),
      )
      .catch(() => {
      });

    return () => abort.abort();
  }, []);

  if (gate.kind === 'pending') return null;

  const decision = decideTicker(candidates, gate.answers.access, gate.answers.catalog);

  if (decision.kind === 'ticker') {
    const reasons = new Map<string, string | null>();
    for (const u of gate.answers.quotes.unavailable) {
      if (typeof u.symbol === 'string' && u.symbol.length > 0) {
        const named = typeof u.reason === 'string' ? u.reason : null;
        const raw = typeof u.rawReason === 'string' ? u.rawReason : null;
        reasons.set(u.symbol, named ?? raw);
      }
    }
    for (const sym of gate.answers.quotes.missing) {
      if (typeof sym === 'string' && sym.length > 0 && !reasons.has(sym)) {
        reasons.set(sym, 'missing');
      }
    }
    const stale = new Set<string>(reasons.keys());

    return (
      <QuotesTicker
        symbols={decision.symbols}
        staleSymbols={stale}
        unavailableReasons={reasons}
      />
    );
  }

  const fromQuotes = decision.reason?.startsWith('quotes:') ?? false;
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
