import type { LiveLabels } from './format';
import { MISSING_VALUE, resolveParam, sourcesOf, type LiveSource, type ParamContext } from './params';
import type { LiveSnapshot } from './snapshot';

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function collectLiveParams(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.includes('{{')) for (const m of value.matchAll(PLACEHOLDER)) out.add(m[1]!);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLiveParams(item, out);
  } else if (isPlainObject(value)) {
    for (const item of Object.values(value)) collectLiveParams(item, out);
  }
  return out;
}

export function substituteLiveParams<T>(value: T, resolve: (name: string) => string): T {
  if (typeof value === 'string') {
    return (value.includes('{{') ? value.replace(PLACEHOLDER, (_m, name: string) => resolve(name)) : value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => substituteLiveParams(item, resolve)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteLiveParams(v, resolve);
    return out as T;
  }
  return value;
}

const warned = new Set<string>();

export function resetLiveParamWarnings(): void {
  warned.clear();
}

function warnOnce(name: string, reason: 'unknown' | 'unavailable', warn: (message: string) => void): void {
  const key = `${reason}:${name}`;
  if (warned.has(key)) return;
  warned.add(key);
  warn(
    reason === 'unknown'
      ? `[live-params] неизвестный параметр {{${name}}} — на сайте «${MISSING_VALUE}»`
      : `[live-params] параметр {{${name}}} недоступен (настройки платформы не прочитаны) — на сайте «${MISSING_VALUE}»`,
  );
}

export function renderLiveParams<T>(data: T, ctx: ParamContext, warn: (message: string) => void = console.warn): T {
  return substituteLiveParams(data, (name) => {
    const outcome = resolveParam(name, ctx);
    if (outcome.ok) return outcome.value;
    warnOnce(name, outcome.reason, warn);
    return MISSING_VALUE;
  });
}

export interface LiveSources {
  snapshot?: () => Promise<LiveSnapshot | null>;
  startBalanceCents?: () => Promise<number | null>;
  labels?: (locale: string) => Promise<LiveLabels | null>;
}

async function safely<T>(load: (() => Promise<T | null>) | undefined): Promise<T | null> {
  if (!load) return null;
  try {
    return await load();
  } catch {
    return null;
  }
}

export async function resolveLiveContent<T>(
  data: T,
  locale: string,
  sources: LiveSources,
  warn: (message: string) => void = console.warn,
): Promise<T> {
  const names = collectLiveParams(data);
  if (names.size === 0) return data;
  const needed = new Set<LiveSource>();
  for (const name of names) for (const s of sourcesOf(name) ?? []) needed.add(s);
  const [snapshot, startBalanceCents, labels] = await Promise.all([
    needed.has('snapshot') ? safely(sources.snapshot) : Promise.resolve(null),
    needed.has('startBalance') ? safely(sources.startBalanceCents) : Promise.resolve(null),
    needed.has('labels') ? safely(sources.labels ? () => sources.labels!(locale) : undefined) : Promise.resolve(null),
  ]);
  return renderLiveParams(data, { locale, snapshot, startBalanceCents, labels }, warn);
}
