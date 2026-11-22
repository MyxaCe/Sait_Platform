import { LIVENESS_TASK_KINDS, type LivenessFrame, type LivenessTask, type LivenessTaskKind } from './types';

export const LIVENESS_TTL_MS = 120_000;
export const LIVENESS_SUBMIT_GRACE_MS = 30_000;
export const MAX_FRAME_BYTES = 3 * 1024 * 1024;
export const MAX_FINGERS = 5;

export type RandomInt = (maxExclusive: number) => number;

export function pickLivenessTasks(rand: RandomInt): LivenessTask[] {
  const pool: LivenessTask[] = [
    { kind: rand(2) === 0 ? 'turn_left' : 'turn_right' },
    { kind: 'show_fingers', count: 1 + rand(MAX_FINGERS) },
    { kind: 'hold_document' },
  ];
  const first = pool.splice(rand(pool.length), 1)[0]!;
  const second = pool[rand(pool.length)]!;
  return [{ kind: 'face_front' }, first, second];
}

export function makeLivenessCode(rand: RandomInt): string {
  return String(1000 + rand(9000));
}

const isTaskKind = (v: unknown): v is LivenessTaskKind =>
  typeof v === 'string' && (LIVENESS_TASK_KINDS as readonly string[]).includes(v);

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function parseLivenessTasks(raw: unknown): LivenessTask[] | null {
  const list = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!Array.isArray(list) || list.length === 0) return null;
  const out: LivenessTask[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) return null;
    const { kind, count } = item as { kind?: unknown; count?: unknown };
    if (!isTaskKind(kind)) return null;
    if (kind === 'show_fingers') {
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_FINGERS) return null;
      out.push({ kind, count });
    } else {
      out.push({ kind });
    }
  }
  return out;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function framesFit(frames: readonly LivenessFrame[], tasks: readonly LivenessTask[], totalLimit: number): boolean {
  if (frames.length !== tasks.length) return false;
  let total = 0;
  let prev = 0;
  for (const f of frames) {
    if (f.contentType !== 'image/jpeg' || !isJpeg(f.bytes) || f.bytes.length > MAX_FRAME_BYTES) return false;
    if (!Number.isFinite(f.elapsedMs) || f.elapsedMs < prev || f.elapsedMs > LIVENESS_TTL_MS) return false;
    prev = f.elapsedMs;
    total += f.bytes.length;
  }
  return total <= totalLimit;
}
