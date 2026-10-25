import { io, type Socket } from 'socket.io-client';
import { parseQuoteBatch, type QuoteBatchParse } from '../parse-quote-batch';
import type { FeedDriver } from '../types';

/**
 * Боевой драйвер. Ожидаемый контракт сервера:
 *  - client → server: 'subscribe' / 'unsubscribe' со списком символов
 *  - server → client: 'quotes:batch' с Quote[] (сервер батчит тики ~250 мс)
 *
 * **Тело разбирается, а не приводится к типу** (WEB-35). Здесь проходит
 * настоящая граница с соседом: `FeedDriver` обещает отдать `Quote[]`, и
 * до этой задачи обещание держалось одним только `as`-подобным
 * объявлением аргумента. Мок такого вопроса не ставит — он сам
 * производит котировки; сокет принимает чужие.
 */
/**
 * Называет вслух то, что разбор отбросил или впервые увидел.
 *
 * **Каждое — один раз.** Батчи идут по четыре в секунду: отчёт на
 * каждый превратил бы находку в шум, а шум отключают. Повторяемость
 * здесь ничего не добавляет — важно, что это вообще случилось.
 *
 * Новость (`novelty`) не отказ: сосед добавил поле или категорию. Но и
 * не пустое место — именно её молчание делало «нам этого не дают»
 * неотличимым от «нам это дают, а мы выбрасываем».
 */
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
      socket.on('quotes:batch', (batch: unknown) => {
        const parsed = parseQuoteBatch(batch);
        report(parsed);
        // Пустой разбор НЕ зовёт обработчик: «обновлений нет» и «мы
        // ничего не поняли» — разные сообщения, и второе не должно
        // выглядеть как первое.
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
