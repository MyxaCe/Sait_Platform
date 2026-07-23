import type { InstrumentCategory, Quote } from './types';

export interface SymbolDef {
  symbol: string;
  name: string;
  category: InstrumentCategory;
  basePrice: number;
  digits: number;
  /** Типичная волатильность одного тика (доля цены) — для мок-фида */
  tickVolatility: number;
}

/** Статичный справочник инструментов. В проде заменяется на GET /v1/instruments. */
export const SYMBOL_UNIVERSE: SymbolDef[] = [
  // Forex
  { symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'forex', basePrice: 1.0842, digits: 5, tickVolatility: 0.00012 },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', category: 'forex', basePrice: 1.2718, digits: 5, tickVolatility: 0.00014 },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', category: 'forex', basePrice: 157.34, digits: 3, tickVolatility: 0.00013 },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', category: 'forex', basePrice: 0.6641, digits: 5, tickVolatility: 0.00016 },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', category: 'forex', basePrice: 0.8934, digits: 5, tickVolatility: 0.00012 },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', category: 'forex', basePrice: 1.3742, digits: 5, tickVolatility: 0.00011 },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', category: 'forex', basePrice: 0.5987, digits: 5, tickVolatility: 0.00017 },
  { symbol: 'EURGBP', name: 'Euro / British Pound', category: 'forex', basePrice: 0.8525, digits: 5, tickVolatility: 0.0001 },
  { symbol: 'EURJPY', name: 'Euro / Japanese Yen', category: 'forex', basePrice: 170.59, digits: 3, tickVolatility: 0.00015 },
  // Металлы
  { symbol: 'XAUUSD', name: 'Gold', category: 'metals', basePrice: 2417.5, digits: 2, tickVolatility: 0.0003 },
  { symbol: 'XAGUSD', name: 'Silver', category: 'metals', basePrice: 29.84, digits: 3, tickVolatility: 0.0006 },
  { symbol: 'XPTUSD', name: 'Platinum', category: 'metals', basePrice: 968.4, digits: 2, tickVolatility: 0.0005 },
  // Криптовалюты
  { symbol: 'BTCUSD', name: 'Bitcoin', category: 'crypto', basePrice: 67450, digits: 0, tickVolatility: 0.0012 },
  { symbol: 'ETHUSD', name: 'Ethereum', category: 'crypto', basePrice: 3495.6, digits: 1, tickVolatility: 0.0016 },
  { symbol: 'SOLUSD', name: 'Solana', category: 'crypto', basePrice: 172.35, digits: 2, tickVolatility: 0.0022 },
  { symbol: 'XRPUSD', name: 'Ripple', category: 'crypto', basePrice: 0.6124, digits: 4, tickVolatility: 0.002 },
  { symbol: 'BNBUSD', name: 'BNB', category: 'crypto', basePrice: 584.2, digits: 1, tickVolatility: 0.0018 },
  // Индексы
  { symbol: 'US500', name: 'S&P 500', category: 'indices', basePrice: 5505.2, digits: 1, tickVolatility: 0.00025 },
  { symbol: 'NAS100', name: 'Nasdaq 100', category: 'indices', basePrice: 19870.5, digits: 1, tickVolatility: 0.00035 },
  { symbol: 'US30', name: 'Dow Jones 30', category: 'indices', basePrice: 40120.3, digits: 1, tickVolatility: 0.0002 },
  { symbol: 'GER40', name: 'DAX 40', category: 'indices', basePrice: 18420.8, digits: 1, tickVolatility: 0.0003 },
  { symbol: 'UK100', name: 'FTSE 100', category: 'indices', basePrice: 8205.6, digits: 1, tickVolatility: 0.00022 },
  { symbol: 'JPN225', name: 'Nikkei 225', category: 'indices', basePrice: 39680.0, digits: 0, tickVolatility: 0.0003 },
  // Акции
  { symbol: 'AAPL', name: 'Apple Inc.', category: 'stocks', basePrice: 226.4, digits: 2, tickVolatility: 0.0008 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', category: 'stocks', basePrice: 444.85, digits: 2, tickVolatility: 0.0007 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', category: 'stocks', basePrice: 122.85, digits: 2, tickVolatility: 0.0015 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', category: 'stocks', basePrice: 182.5, digits: 2, tickVolatility: 0.001 },
  { symbol: 'META', name: 'Meta Platforms Inc.', category: 'stocks', basePrice: 475.9, digits: 2, tickVolatility: 0.0012 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', category: 'stocks', basePrice: 179.2, digits: 2, tickVolatility: 0.0009 },
  { symbol: 'TSLA', name: 'Tesla Inc.', category: 'stocks', basePrice: 248.3, digits: 2, tickVolatility: 0.0018 },
  // Энергоносители
  { symbol: 'USOIL', name: 'WTI Crude Oil', category: 'energy', basePrice: 81.62, digits: 2, tickVolatility: 0.0007 },
  { symbol: 'UKOIL', name: 'Brent Crude Oil', category: 'energy', basePrice: 85.14, digits: 2, tickVolatility: 0.0007 },
  { symbol: 'NGAS', name: 'Natural Gas', category: 'energy', basePrice: 2.184, digits: 3, tickVolatility: 0.0015 },
];

/** Куратированный набор для бегущей строки — самые ликвидные инструменты. */
export const DEFAULT_TICKER_SYMBOLS = [
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'XAUUSD',
  'XAGUSD',
  'BTCUSD',
  'ETHUSD',
  'US500',
  'NAS100',
  'GER40',
  'AAPL',
  'NVDA',
  'TSLA',
  'USOIL',
];

export function findSymbol(symbol: string): SymbolDef | undefined {
  const upper = symbol.toUpperCase();
  return SYMBOL_UNIVERSE.find((d) => d.symbol === upper);
}

/**
 * Начальный снапшот для стора: SSR и первый клиентский рендер получают
 * одинаковые цены (нет hydration mismatch и CLS), живой фид подхватывает поверх.
 */
export function createInitialQuotes(): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const def of SYMBOL_UNIVERSE) {
    out[def.symbol] = {
      symbol: def.symbol,
      name: def.name,
      category: def.category,
      price: def.basePrice,
      digits: def.digits,
      changePercent: 0,
      ts: 0,
    };
  }
  return out;
}
