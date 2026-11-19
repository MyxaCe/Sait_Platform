import { describe, expect, it } from 'vitest';
import {
  bandFor,
  createSeries,
  easeSpan,
  MIN_SPAN_RATIO,
  projectSeries,
  pushSample,
  targetSpan,
  trimSeries,
  visibleSamples,
} from './series';

describe('ряд точек: только настоящие чтения, по возрастанию времени', () => {
  it('принимает цену с растущим временем', () => {
    const s = createSeries();
    expect(pushSample(s, 1_000, 100)).toBe(true);
    expect(pushSample(s, 2_000, 101)).toBe(true);
    expect(s.samples).toEqual([
      { t: 1_000, p: 100 },
      { t: 2_000, p: 101 },
    ]);
  });

  it.each([
    ['нулевая цена', 3_000, 0],
    ['отрицательная цена', 3_000, -1],
    ['NaN', 3_000, Number.NaN],
    ['время назад', 1_500, 100],
    ['то же время', 2_000, 100],
    ['время 0 — стартовый снапшот', 0, 100],
  ])('отвергает: %s', (_name, t, p) => {
    const s = createSeries();
    pushSample(s, 1_000, 100);
    pushSample(s, 2_000, 101);
    expect(pushSample(s, t, p)).toBe(false);
    expect(s.samples).toHaveLength(2);
  });
});

describe('окно точек', () => {
  const series = () => {
    const s = createSeries();
    for (const t of [1_000, 2_000, 3_000, 4_000, 5_000]) pushSample(s, t, t / 10);
    return s;
  };

  it('обрезка оставляет одну точку слева от окна, чтобы линия входила с края', () => {
    const s = series();
    trimSeries(s, 5_000, 2_500);
    expect(s.samples.map((x) => x.t)).toEqual([2_000, 3_000, 4_000, 5_000]);
  });

  it('видимые точки — окно плюс одна предыдущая', () => {
    expect(visibleSamples(series(), 5_000, 1_500).map((x) => x.t)).toEqual([3_000, 4_000, 5_000]);
  });

  it('пустой ряд — пусто', () => {
    expect(visibleSamples(createSeries(), 5_000, 1_000)).toEqual([]);
    expect(targetSpan([])).toBeNull();
  });
});

describe('масштаб', () => {
  it('диапазон по минимуму и максимуму окна', () => {
    expect(targetSpan([{ t: 1, p: 90 }, { t: 2, p: 110 }])).toEqual({ lo: 90, hi: 110 });
  });

  it('одна цена не растягивается в шум: минимальный размах вокруг неё', () => {
    const span = targetSpan([{ t: 1, p: 100 }])!;
    expect(span.hi - span.lo).toBeCloseTo(100 * MIN_SPAN_RATIO);
    expect((span.hi + span.lo) / 2).toBeCloseTo(100);
  });

  it('сглаживание идёт к цели и без истории берёт её сразу', () => {
    const target = { lo: 0, hi: 10 };
    expect(easeSpan(null, target, 0.1)).toEqual(target);
    expect(easeSpan({ lo: 10, hi: 20 }, target, 0.5)).toEqual({ lo: 5, hi: 15 });
  });
});

describe('проекция: линия течёт справа налево', () => {
  const view = {
    now: 10_000,
    windowMs: 10_000,
    width: 1_000,
    band: { top: 0, height: 100 },
    span: { lo: 0, hi: 100 },
    tailMs: 5_000,
  };

  it('время → x от левого края окна к правому, цена → y сверху вниз', () => {
    const pts = projectSeries(
      [
        { t: 0, p: 0 },
        { t: 5_000, p: 100 },
      ],
      { ...view, tailMs: 0 },
    );
    expect(pts).toEqual([0, 100, 500, 0]);
  });

  it('пока источник свеж, последняя цена тянется до правого края', () => {
    const pts = projectSeries([{ t: 8_000, p: 50 }], view);
    expect(pts).toEqual([800, 50, 1_000, 50]);
  });

  it('замолчавший источник не продлевается: линия уходит влево', () => {
    const pts = projectSeries([{ t: 2_000, p: 50 }], view);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toBeCloseTo(200);
  });

  it('точки плотнее пикселя прореживаются, последняя остаётся', () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ t: 9_000 + i, p: 50 }));
    const pts = projectSeries(samples, { ...view, tailMs: 0 });
    expect(pts.length).toBeLessThan(samples.length * 2);
    expect(pts[pts.length - 2]).toBeCloseTo(909.9);
  });
});

describe('полосы линий', () => {
  it('полосы не выходят за высоту и идут сверху вниз', () => {
    const bands = [0, 1, 2, 3].map((i) => bandFor(i, 4, 800));
    for (const b of bands) {
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.top + b.height).toBeLessThanOrEqual(800);
    }
    expect(bands.map((b) => b.top)).toEqual([...bands.map((b) => b.top)].sort((a, b) => a - b));
  });
});
