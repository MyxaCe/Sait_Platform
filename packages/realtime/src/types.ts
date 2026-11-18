export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'simulated';

export const INSTRUMENT_CATEGORIES = [
  'forex',
  'metals',
  'crypto',
  'indices',
  'stocks',
  'energy',
] as const;

export type InstrumentCategory = (typeof INSTRUMENT_CATEGORIES)[number];

export interface Quote {
  symbol: string;
  name: string;
  category: InstrumentCategory;
  price: number;
  digits: number;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  ts: number;
}

export interface FeedDriver {
  connect(onBatch: (batch: Quote[]) => void, onStatus: (s: ConnStatus) => void): void;
  subscribe(symbols: string[]): void;
  unsubscribe(symbols: string[]): void;
  disconnect(): void;
}
