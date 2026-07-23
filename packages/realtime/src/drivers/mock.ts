import { SYMBOL_UNIVERSE } from '../data';
import type { ConnStatus, FeedDriver, Quote } from '../types';

const TICK_INTERVAL_MS = 800;
const CONNECT_DELAY_MS = 400;

/**
 * Мок-фид: случайное блуждание цен вокруг базовых значений.
 * Полностью повторяет контракт боевого socket.io-драйвера,
 * поэтому переход на реальный фид не трогает ни стор, ни UI.
 */
export function createMockDriver(): FeedDriver {
  const defs = new Map(SYMBOL_UNIVERSE.map((d) => [d.symbol, d]));
  const state = new Map<string, { price: number; open: number }>();
  const subscribed = new Set<string>();

  let timer: ReturnType<typeof setInterval> | null = null;
  let emitBatch: ((batch: Quote[]) => void) | null = null;
  let emitStatus: ((s: ConnStatus) => void) | null = null;

  const toQuote = (symbol: string): Quote | null => {
    const def = defs.get(symbol);
    const s = state.get(symbol);
    if (!def || !s) return null;
    return {
      symbol: def.symbol,
      name: def.name,
      category: def.category,
      digits: def.digits,
      price: Number(s.price.toFixed(def.digits)),
      changePercent: (s.price / s.open - 1) * 100,
      ts: Date.now(),
    };
  };

  const ensureState = (symbol: string) => {
    if (state.has(symbol)) return;
    const def = defs.get(symbol);
    if (!def) return;
    // День уже "идёт": открытие чуть в стороне от текущей цены,
    // чтобы changePercent не был нулевым у всех инструментов
    const drift = 1 + (Math.random() - 0.5) * 0.02;
    state.set(symbol, { price: def.basePrice, open: def.basePrice / drift });
  };

  const tick = () => {
    const batch: Quote[] = [];
    for (const symbol of subscribed) {
      // Не каждый инструмент тикает каждый интервал — как в реальном фиде
      if (Math.random() > 0.65) continue;
      const def = defs.get(symbol);
      const s = state.get(symbol);
      if (!def || !s) continue;
      s.price *= 1 + (Math.random() - 0.5) * 2 * def.tickVolatility;
      const q = toQuote(symbol);
      if (q) batch.push(q);
    }
    if (batch.length && emitBatch) emitBatch(batch);
  };

  return {
    connect(onBatch, onStatus) {
      emitBatch = onBatch;
      emitStatus = onStatus;
      emitStatus('connecting');
      setTimeout(() => {
        emitStatus?.('connected');
        // Мгновенный снапшот всех подписок, дальше — тики
        const snapshot = [...subscribed].map(toQuote).filter((q): q is Quote => q !== null);
        if (snapshot.length) emitBatch?.(snapshot);
        timer = setInterval(tick, TICK_INTERVAL_MS);
      }, CONNECT_DELAY_MS);
    },

    subscribe(symbols) {
      for (const s of symbols) {
        ensureState(s);
        subscribed.add(s);
      }
    },

    unsubscribe(symbols) {
      for (const s of symbols) subscribed.delete(s);
    },

    disconnect() {
      if (timer) clearInterval(timer);
      timer = null;
      emitBatch = null;
      emitStatus = null;
    },
  };
}
