import { findSymbol } from '@broker/realtime';
import { describeSlippage } from './slippage';

export type RawParams = Record<string, unknown>;

export function formatPriceForSymbol(price: number, symbol: string, digits?: number): string {
  const d = digits ?? findSymbol(symbol)?.digits;
  return d === undefined ? String(price) : price.toFixed(d);
}

function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = String(value);
  const dot = text.indexOf('.');
  if (dot < 0) return 0;
  return text.length - dot - 1;
}

const MAX_PRICE_DIGITS = 8;

export function priceDigitsFor(symbol: string, values: number[]): number {
  const catalogue = findSymbol(symbol)?.digits ?? 2;
  const fromValues = Math.max(0, ...values.filter(isFiniteNumber).map(decimalsOf));
  return Math.min(Math.max(catalogue, fromValues), MAX_PRICE_DIGITS);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function tradeExecutedParams(raw: RawParams): Record<string, string> | null {
  const { symbol, side, volume, price, level, acrossGap } = raw;

  if (!isNonEmptyString(symbol)) return null;
  if (side !== 'buy' && side !== 'sell') return null;
  if (!isFiniteNumber(volume)) return null;
  if (!isFiniteNumber(price)) return null;

  const digits = priceDigitsFor(symbol, [price, isFiniteNumber(level) ? level : Number.NaN]);
  const verdict = describeSlippage({
    execution: price,
    level: isFiniteNumber(level) ? level : null,
    side,
    digits,
  });

  return {
    symbol,
    side,
    volume: String(volume),
    price: formatPriceForSymbol(price, symbol, digits),
    level: isFiniteNumber(level) ? formatPriceForSymbol(level, symbol, digits) : '',
    slippage: verdict.kind === 'none' || verdict.kind === 'unknown'
      ? ''
      : formatPriceForSymbol(verdict.amount, symbol, digits),
    slippageKind: verdict.kind,

    acrossGap: acrossGap === true ? 'yes' : acrossGap === false ? 'no' : 'notApplicable',
  };
}

export function displayParams(type: string, raw: RawParams): Record<string, unknown> | null {
  if (type === 'tradeExecuted') return tradeExecutedParams(raw);
  if (type === 'marginCalled') return marginCalledParams(raw);
  return raw;
}

export interface MarginParams extends Record<string, string> {
  level: string;
  equity: string;
  usedMargin: string;
  stopOut: string;
  remaining: string;
  hasStopOut: 'yes' | 'no';
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function marginCalledParams(raw: RawParams): MarginParams | null {
  const { marginLevelPct, stopOutLevelPct, equityCents, usedMarginCents } = raw;

  if (!isFiniteNumber(marginLevelPct)) return null;
  if (!isFiniteNumber(equityCents) || !isFiniteNumber(usedMarginCents)) return null;

  const hasStopOut = isFiniteNumber(stopOutLevelPct);

  return {
    level: String(marginLevelPct),
    equity: money(equityCents),
    usedMargin: money(usedMarginCents),
    stopOut: hasStopOut ? String(stopOutLevelPct) : '',
    remaining: hasStopOut ? String(marginLevelPct - (stopOutLevelPct as number)) : '',
    hasStopOut: hasStopOut ? 'yes' : 'no',
  };
}

export function notificationKey(type: string, params: Record<string, unknown> | null): string {
  if (type === 'marginCalled' && params?.hasStopOut === 'no') return 'marginCalledNoStopOut';
  if (type === 'tradeExecuted') {
    if (params?.slippageKind === 'against') return 'tradeExecutedWorse';
    if (params?.slippageKind === 'favour') return 'tradeExecutedBetter';
  }
  return type;
}
