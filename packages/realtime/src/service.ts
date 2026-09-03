import { createMockDriver } from './drivers/mock';
import { createSocketIoDriver } from './drivers/socketio';
import { useQuotesStore } from './store';
import type { FeedDriver } from './types';

/**
 * Singleton поверх драйвера: один сокет на вкладку,
 * подписки — по счётчику ссылок (несколько виджетов могут
 * смотреть один символ, отписка уходит когда отпустил последний).
 */
export class RealtimeService {
  private driver: FeedDriver | null = null;
  private refs = new Map<string, number>();

  /** customDriver — для тестов и нестандартных транспортов */
  connect(customDriver?: FeedDriver) {
    if (this.driver) return;
    if (!customDriver && typeof window === 'undefined') return;

    const url = process.env.NEXT_PUBLIC_WS_URL;
    // Подлинность данных решается ЗДЕСЬ и больше нигде: источник настоящий
    // тогда и только тогда, когда у нас есть его адрес. Драйвер не спрашивают
    // и переопределить это он не может — ровно самоназвание мока сделало его
    // неотличимым от боевого фида (B-018). Тестовый фейк без адреса источника
    // тоже не живой: подделать подлинность не должно быть возможно и в тестах.
    const live = Boolean(url);
    this.driver = customDriver ?? (url ? createSocketIoDriver(url) : createMockDriver());

    this.driver.connect(
      (batch) => useQuotesStore.getState().applyBatch(batch),
      (status) => useQuotesStore.getState().setStatus(live ? status : 'simulated'),
    );
    if (this.refs.size) this.driver.subscribe([...this.refs.keys()]);
  }

  /** Возвращает функцию отписки — удобно как cleanup в useEffect. */
  subscribe(symbols: string[]): () => void {
    const fresh = symbols.filter((s) => {
      const n = (this.refs.get(s) ?? 0) + 1;
      this.refs.set(s, n);
      return n === 1;
    });
    if (fresh.length) this.driver?.subscribe(fresh);

    return () => {
      const dead = symbols.filter((s) => {
        const n = (this.refs.get(s) ?? 1) - 1;
        if (n <= 0) {
          this.refs.delete(s);
          return true;
        }
        this.refs.set(s, n);
        return false;
      });
      if (dead.length) this.driver?.unsubscribe(dead);
    };
  }

  disconnect() {
    this.driver?.disconnect();
    this.driver = null;
  }
}

export const realtime = new RealtimeService();
