import { io, type Socket } from 'socket.io-client';
import { parseQuoteBatch, type QuoteBatchParse } from '../parse-quote-batch';
import type { FeedDriver } from '../types';

function createReporter(): (parse: QuoteBatchParse) => void {
  const seen = new Set<string>();

  return ({ rejected, novelties }) => {
    for (const n of novelties) {
      if (seen.has(n)) continue;
      seen.add(n);
      console.warn(`[realtime] источник прислал незнакомое: ${n}`);
    }
    for (const r of rejected) {
      const key = `reject:${r.symbol ?? '(нет символа)'}:${r.field}:${r.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.warn(
        `[realtime] котировка отброшена: символ ${r.symbol ?? 'не назван'}, ` +
          `поле ${r.field}, ${r.reason}`,
      );
    }
  };
}

export function createSocketIoDriver(url: string): FeedDriver {
  let socket: Socket | null = null;
  const subscribed = new Set<string>();
  const report = createReporter();

  return {
    connect(onBatch, onStatus) {
      onStatus('connecting');
      socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 30_000,
        randomizationFactor: 0.5,
      });

      socket.on('connect', () => {
        onStatus('connected');
        if (subscribed.size) socket?.emit('subscribe', [...subscribed]);
      });
      socket.on('disconnect', () => onStatus('reconnecting'));
      socket.io.on('reconnect_attempt', () => onStatus('reconnecting'));
      socket.io.on('reconnect_failed', () => onStatus('offline'));
      socket.on('quotes:batch', (batch: unknown) => {
        const parsed = parseQuoteBatch(batch);
        report(parsed);
        if (parsed.quotes.length) onBatch(parsed.quotes);
      });
    },

    subscribe(symbols) {
      for (const s of symbols) subscribed.add(s);
      if (socket?.connected) socket.emit('subscribe', symbols);
    },

    unsubscribe(symbols) {
      for (const s of symbols) subscribed.delete(s);
      if (socket?.connected) socket.emit('unsubscribe', symbols);
    },

    disconnect() {
      socket?.disconnect();
      socket = null;
    },
  };
}
