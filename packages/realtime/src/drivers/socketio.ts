import { io, type Socket } from 'socket.io-client';
import type { FeedDriver, Quote } from '../types';

/**
 * Боевой драйвер. Ожидаемый контракт сервера:
 *  - client → server: 'subscribe' / 'unsubscribe' со списком символов
 *  - server → client: 'quotes:batch' с Quote[] (сервер батчит тики ~250 мс)
 */
export function createSocketIoDriver(url: string): FeedDriver {
  let socket: Socket | null = null;
  const subscribed = new Set<string>();

  return {
    connect(onBatch, onStatus) {
      onStatus('connecting');
      socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 30_000,
        // jitter: при массовом обрыве клиенты не переподключаются одновременно
        randomizationFactor: 0.5,
      });

      socket.on('connect', () => {
        onStatus('connected');
        // Восстановление подписок после реконнекта
        if (subscribed.size) socket?.emit('subscribe', [...subscribed]);
      });
      socket.on('disconnect', () => onStatus('reconnecting'));
      socket.io.on('reconnect_attempt', () => onStatus('reconnecting'));
      socket.io.on('reconnect_failed', () => onStatus('offline'));
      socket.on('quotes:batch', (batch: Quote[]) => onBatch(batch));
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
