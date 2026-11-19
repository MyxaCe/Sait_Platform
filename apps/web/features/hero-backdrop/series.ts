export interface Sample {
  t: number;
  p: number;
}

export interface Series {
  samples: Sample[];
}

export interface Span {
  lo: number;
  hi: number;
}

export interface Band {
  top: number;
  height: number;
}

export interface Projection {
  now: number;
  windowMs: number;
  width: number;
  band: Band;
  span: Span;
  tailMs: number;
}

export const MIN_SPAN_RATIO = 0.0015;

export function createSeries(): Series {
  return { samples: [] };
}

export function pushSample(series: Series, t: number, p: number): boolean {
  if (!Number.isFinite(t) || t <= 0) return false;
  if (!Number.isFinite(p) || p <= 0) return false;
  const last = series.samples[series.samples.length - 1];
  if (last && t <= last.t) return false;
  series.samples.push({ t, p });
  return true;
}

export function trimSeries(series: Series, now: number, windowMs: number): void {
  const start = now - windowMs;
  let firstInside = series.samples.findIndex((s) => s.t >= start);
  if (firstInside === -1) firstInside = series.samples.length;
  const drop = firstInside - 1;
  if (drop > 0) series.samples.splice(0, drop);
}

export function visibleSamples(series: Series, now: number, windowMs: number): Sample[] {
  const start = now - windowMs;
  const out: Sample[] = [];
  const { samples } = series;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]!;
    const next = samples[i + 1];
    if (s.t >= start || (next !== undefined && next.t >= start)) out.push(s);
  }
  return out;
}

export function targetSpan(samples: readonly Sample[]): Span | null {
  if (samples.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    if (s.p < lo) lo = s.p;
    if (s.p > hi) hi = s.p;
  }
  const mid = (lo + hi) / 2;
  const minSpan = mid * MIN_SPAN_RATIO;
  if (hi - lo < minSpan) {
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  return { lo, hi };
}

export function easeSpan(current: Span | null, target: Span, k: number): Span {
  if (!current) return target;
  return {
    lo: current.lo + (target.lo - current.lo) * k,
    hi: current.hi + (target.hi - current.hi) * k,
  };
}

export function projectSeries(samples: readonly Sample[], view: Projection): number[] {
  if (samples.length === 0) return [];
  const { now, windowMs, width, band, span, tailMs } = view;
  const range = span.hi - span.lo || 1;
  const xOf = (t: number) => width * (1 - (now - t) / windowMs);
  const yOf = (p: number) => band.top + band.height * (1 - (p - span.lo) / range);
  const out: number[] = [];
  let lastX = -Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]!;
    const x = xOf(s.t);
    const isLast = i === samples.length - 1;
    if (!isLast && x - lastX < 0.75) continue;
    out.push(x, yOf(s.p));
    lastX = x;
  }
  const last = samples[samples.length - 1]!;
  if (now - last.t <= tailMs && now > last.t) out.push(width, yOf(last.p));
  return out;
}

export function bandFor(index: number, count: number, height: number): Band {
  const bandHeight = height * (count > 2 ? 0.3 : 0.36);
  const first = height * 0.22;
  const last = height * 0.78;
  const center = count <= 1 ? (first + last) / 2 : first + ((last - first) * index) / (count - 1);
  return { top: center - bandHeight / 2, height: bandHeight };
}
