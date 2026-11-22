import { describe, expect, it } from 'vitest';
import {
  LIVENESS_TTL_MS,
  MAX_FRAME_BYTES,
  framesFit,
  isJpeg,
  makeLivenessCode,
  parseLivenessTasks,
  pickLivenessTasks,
} from './liveness';

const seq = (values: number[]) => {
  let i = 0;
  return (max: number) => values[i++ % values.length]! % max;
};

const jpeg = (size = 100) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff]);
  return b;
};

describe('задание селфи', () => {
  it('первый снимок — лицо прямо, дальше два разных действия', () => {
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 5; b++)
        for (let c = 0; c < 3; c++)
          for (let d = 0; d < 2; d++) {
            const tasks = pickLivenessTasks(seq([a, b, c, d]));
            expect(tasks).toHaveLength(3);
            expect(tasks[0]).toEqual({ kind: 'face_front' });
            expect(tasks[1]!.kind).not.toBe(tasks[2]!.kind);
            for (const t of tasks.slice(1)) {
              expect(['turn_left', 'turn_right', 'show_fingers', 'hold_document']).toContain(t.kind);
              if (t.kind === 'show_fingers') expect(t.count).toBeGreaterThanOrEqual(1);
              if (t.kind === 'show_fingers') expect(t.count).toBeLessThanOrEqual(5);
            }
          }
  });

  it('код — четыре цифры', () => {
    expect(makeLivenessCode(() => 0)).toBe('1000');
    expect(makeLivenessCode((m) => m - 1)).toBe('9999');
  });

  it('разбор заданий из базы закрыт: неизвестное действие или пальцы вне 1..5 — null', () => {
    expect(parseLivenessTasks('[{"kind":"face_front"},{"kind":"show_fingers","count":3}]')).toEqual([
      { kind: 'face_front' },
      { kind: 'show_fingers', count: 3 },
    ]);
    expect(parseLivenessTasks([{ kind: 'blink' }])).toBeNull();
    expect(parseLivenessTasks([{ kind: 'show_fingers', count: 9 }])).toBeNull();
    expect(parseLivenessTasks([])).toBeNull();
    expect(parseLivenessTasks('нет')).toBeNull();
  });
});

describe('снимки селфи', () => {
  const tasks = pickLivenessTasks(() => 0);
  const frame = (elapsedMs: number, bytes = jpeg()) => ({ bytes, contentType: 'image/jpeg', elapsedMs });

  it('JPEG узнаётся по сигнатуре, PNG — нет', () => {
    expect(isJpeg(jpeg())).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it('три JPEG по порядку времени в пределах срока — годны', () => {
    expect(framesFit([frame(1000), frame(5000), frame(9000)], tasks, 10_000_000)).toBe(true);
  });

  it('не тот счёт, не JPEG, обратный порядок, вне срока, перебор размера — отказ', () => {
    expect(framesFit([frame(1000), frame(2000)], tasks, 10_000_000)).toBe(false);
    expect(framesFit([frame(1), frame(2), { ...frame(3), contentType: 'image/png' }], tasks, 10_000_000)).toBe(false);
    expect(framesFit([frame(1), frame(2), frame(3, new Uint8Array([1, 2, 3, 4]))], tasks, 10_000_000)).toBe(false);
    expect(framesFit([frame(5000), frame(1000), frame(9000)], tasks, 10_000_000)).toBe(false);
    expect(framesFit([frame(1), frame(2), frame(LIVENESS_TTL_MS + 1)], tasks, 10_000_000)).toBe(false);
    expect(framesFit([frame(-1), frame(2), frame(3)], tasks, 10_000_000)).toBe(false);
    expect(framesFit([frame(1), frame(2), frame(3, jpeg(MAX_FRAME_BYTES + 1))], tasks, 100_000_000)).toBe(false);
    expect(framesFit([frame(1), frame(2), frame(3)], tasks, 200)).toBe(false);
  });
});
