import type { OnboardingPart, OnboardingPartConfig, OnboardingResponse } from '@broker/api-client';
import { onboardingResponseSchema, ONBOARDING_PARTS } from '@broker/api-client';

export type TourStatus = 'done' | 'skipped';

export interface PartMark {
  v: number;
  s: TourStatus;
}

/** Значение колонки users.onboarding. */
export interface OnboardingState {
  autostart?: boolean;
  registration?: PartMark;
  cabinet?: PartMark;
  terminal?: PartMark;
}

export function readOnboardingState(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: OnboardingState = {};
  if (src.autostart === true) out.autostart = true;
  for (const part of ONBOARDING_PARTS) {
    const mark = src[part] as { v?: unknown; s?: unknown } | undefined;
    if (mark && Number.isInteger(mark.v) && (mark.s === 'done' || mark.s === 'skipped')) {
      out[part] = { v: mark.v as number, s: mark.s };
    }
  }
  return out;
}

/**
 * Показывать ли часть сама. Только новичку (autostart из регистрации), только
 * если эту версию части он ещё не видел. Остальным — только по кнопке «?».
 */
export function shouldAutostart(state: OnboardingState, part: OnboardingPartConfig | undefined): boolean {
  if (!part || part.steps.length === 0) return false;
  if (!state.autostart) return false;
  const mark = state[part.part];
  return !mark || mark.v < part.version;
}

/** Разбор ответа CMS: битый ответ → null (экскурсии нет, встроенных текстов нет). */
export function parseOnboarding(data: unknown): OnboardingResponse | null {
  const parsed = onboardingResponseSchema.safeParse(data);
  if (!parsed.success) return null;
  const parts = parsed.data.parts
    .map((p) => ({ ...p, steps: p.steps.filter((s) => s.title.trim() !== '' || s.body.trim() !== '') }))
    .filter((p) => p.steps.length > 0);
  return parts.length > 0 ? { ...parsed.data, parts } : null;
}

export function partOf(config: OnboardingResponse | null, part: OnboardingPart): OnboardingPartConfig | undefined {
  return config?.parts.find((p) => p.part === part);
}

export function markPart(state: OnboardingState, part: OnboardingPart, version: number, status: TourStatus): OnboardingState {
  return { ...state, [part]: { v: version, s: status } };
}

/** Флаг выката. По умолчанию выключено. */
export function tourEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ONBOARDING_TOUR_ENABLED === '1';
}
