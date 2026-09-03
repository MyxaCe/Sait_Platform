/**
 * Состояние фида. `simulated` — данные не настоящие: цены синтезированы, к
 * рынку отношения не имеют. Это НЕ подвид `connected`: подключённость и
 * подлинность — разные вопросы, и их склейка породила B-018 (мок рапортовал
 * `connected`, индикатор горел «Данные в реальном времени» над случайным
 * блужданием). Подлинность решает RealtimeService по наличию адреса источника,
 * драйвера об этом не спрашивают — самоназвание драйвера подделывается даром.
 */
export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'simulated';

export type InstrumentCategory =
  | 'forex'
  | 'metals'
  | 'crypto'
  | 'indices'
  | 'stocks'
  | 'energy';

export interface Quote {
  symbol: string;
  name: string;
  category: InstrumentCategory;
  /** Текущая цена (mid) */
  price: number;
  /** Знаков после запятой для отображения */
  digits: number;
  /** Изменение от открытия дня, % */
  changePercent: number;
  /** Unix ms последнего обновления; 0 — статичный начальный снапшот */
  ts: number;
}

/**
 * Транспорт фида. Реализации: socket.io (боевой) и мок (random walk).
 * Контракт одинаковый, поэтому замена мока на реальный фид — смена URL.
 */
export interface FeedDriver {
  connect(onBatch: (batch: Quote[]) => void, onStatus: (s: ConnStatus) => void): void;
  subscribe(symbols: string[]): void;
  unsubscribe(symbols: string[]): void;
  disconnect(): void;
}
