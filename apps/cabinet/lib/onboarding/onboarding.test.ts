import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '@broker/support/testing';
import { anchorPart, anchorSelectors, CABINET_ANCHORS, navTourId } from './anchors';
import { markPart, parseOnboarding, partOf, readOnboardingState, shouldAutostart, tourEnabled } from './state';

const env = vi.hoisted(() => ({
  pg: null as unknown as import('@broker/support/testing').TestDb,
  user: null as { id: string } | null,
}));
vi.mock('../db', () => ({ getPool: () => env.pg }));
vi.mock('../auth/session', () => ({ getSessionUser: async () => env.user }));

const labels = { back: 'Назад', next: 'Далее', skip: 'Пропустить', done: 'Готово', help: 'Экскурсия', stepOf: 'Шаг {current} из {total}' };
const step = (anchor: string, title = 'T', body = 'B') => ({ anchor, title, body });
const cms = {
  parts: [
    { part: 'cabinet', version: 2, steps: [step('cabinet.balanceDemo'), step('cabinet.trade', ' ', ' ')] },
    { part: 'terminal', version: 1, steps: [step('terminal.pairs', '', '')] },
  ],
  labels,
};

describe('ответ CMS', () => {
  it('пустые шаги и части без шагов отбрасываются; битый ответ — экскурсии нет', () => {
    const parsed = parseOnboarding(cms)!;
    expect(parsed.parts.map((p) => p.part)).toEqual(['cabinet']);
    expect(parsed.parts[0]!.steps.map((s) => s.anchor)).toEqual(['cabinet.balanceDemo']);
    expect(parseOnboarding({ parts: [], labels })).toBeNull();
    expect(parseOnboarding({ parts: 'x' })).toBeNull();
    expect(parseOnboarding(null)).toBeNull();
    expect(partOf(parsed, 'terminal')).toBeUndefined();
  });
});

describe('показ сам — только новичку и только непросмотренной версии', () => {
  const part = parseOnboarding(cms)!.parts[0]!;
  it('уже зарегистрированный (нет autostart) — только по «?»', () => {
    expect(shouldAutostart({}, part)).toBe(false);
  });
  it('новичок — один раз; пропуск запоминается; новая версия части — снова', () => {
    expect(shouldAutostart({ autostart: true }, part)).toBe(true);
    expect(shouldAutostart(markPart({ autostart: true }, 'cabinet', 2, 'skipped'), part)).toBe(false);
    expect(shouldAutostart(markPart({ autostart: true }, 'cabinet', 1, 'done'), part)).toBe(true);
  });
  it('мусор в колонке не ломает чтение', () => {
    expect(readOnboardingState('x')).toEqual({});
    expect(readOnboardingState({ autostart: 'yes', cabinet: { v: '1', s: 'done' }, terminal: { v: 3, s: 'skipped' } })).toEqual({
      terminal: { v: 3, s: 'skipped' },
    });
  });
  it('флаг выката по умолчанию выключен', () => {
    expect(tourEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(tourEnabled({ ONBOARDING_TOUR_ENABLED: '1' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('якоря', () => {
  it('у каждого якоря есть селектор и часть; неизвестный — пусто', () => {
    for (const [name, selectors] of Object.entries(CABINET_ANCHORS)) {
      expect(selectors.length, name).toBeGreaterThan(0);
      expect(anchorPart(name), name).not.toBeNull();
    }
    expect(anchorSelectors('nope')).toEqual([]);
    expect(anchorPart('nope.x')).toBeNull();
  });
  it('пункты меню получают data-tour', () => {
    expect(navTourId('/trade')).toBe('nav-trade');
    expect(navTourId('/', true)).toBe('mnav-home');
    expect(navTourId('/profile/security')).toBe('nav-profile');
  });
});

describe('отметка в базе', () => {
  let userId: string;
  beforeAll(async () => {
    env.pg = await createTestDb();
  });
  afterAll(async () => env.pg.close());
  beforeEach(async () => {
    const res = await env.pg.query(
      `INSERT INTO users (id, email, password_hash, full_name, locale, onboarding)
       VALUES (gen_random_uuid(), $1, 'x', 'Клиент', 'ru', '{"autostart": true}'::jsonb) RETURNING id`,
      [`tour-${Date.now()}-${Math.random()}@example.test`],
    );
    userId = res.rows[0]!.id as string;
    env.user = { id: userId };
  });

  it('у существующих клиентов по умолчанию пусто', async () => {
    const res = await env.pg.query(
      `INSERT INTO users (id, email, password_hash, full_name, locale) VALUES (gen_random_uuid(), $1, 'x', 'Старый', 'ru') RETURNING onboarding`,
      [`old-${Date.now()}@example.test`],
    );
    expect(res.rows[0]!.onboarding).toEqual({});
  });

  it('пишет часть своей строки, autostart остаётся для других частей', async () => {
    const { saveTourResultAction } = await import('./actions');
    expect(await saveTourResultAction('cabinet', 2, 'done')).toBe(true);
    expect(await saveTourResultAction('terminal', 1, 'skipped')).toBe(true);
    const { loadOnboardingState } = await import('./server');
    expect(await loadOnboardingState(userId)).toEqual({
      autostart: true,
      cabinet: { v: 2, s: 'done' },
      terminal: { v: 1, s: 'skipped' },
    });
  });

  it('негодные данные и чужой (не вошедший) клиент — отказ', async () => {
    const { saveTourResultAction } = await import('./actions');
    expect(await saveTourResultAction('admin' as never, 1, 'done')).toBe(false);
    expect(await saveTourResultAction('cabinet', 0, 'done')).toBe(false);
    expect(await saveTourResultAction('cabinet', 1, 'maybe' as never)).toBe(false);
    env.user = null;
    expect(await saveTourResultAction('cabinet', 1, 'done')).toBe(false);
  });
});
