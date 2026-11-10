import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeClick } from '@broker/promo/attribution';

/**
 * Регистрация пишет атрибуцию (first-click, срок из настроек), страну и IP —
 * ТОЙ ЖЕ транзакцией, что пользователя. Самореферал (IP реферера) отсекается:
 * строка `rejected`, наград по ней не будет. Без cookie/параметров —
 * регистрация как раньше.
 */

const NOW = new Date();
const REFERRER = '00000000-0000-4000-8000-0000000c0001';

interface Q {
  sql: string;
  params: unknown[];
}
const queries: Q[] = [];
const state = { windowDays: 30 as number | null, referrerIp: '203.0.113.7' };

function answer(sql: string, params: unknown[]): { rows: Record<string, unknown>[] } {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('FROM platform_promo_settings')) {
    return state.windowDays === null
      ? { rows: [] }
      : { rows: [{ promotions_enabled: true, attribution_window_days: state.windowDays, blocked_countries: [] }] };
  }
  if (s.includes('FROM referral_codes rc JOIN users u')) {
    return params[0] === 'REFCODE8' ? { rows: [{ id: REFERRER, email: 'anna@x.io', registration_ip: state.referrerIp }] } : { rows: [] };
  }
  if (s.includes('SELECT 1 FROM users WHERE id::text = $1 AND registration_ip = $2')) {
    return params[1] === state.referrerIp ? { rows: [{ '?column?': 1 }] } : { rows: [] };
  }
  if (s.includes('SELECT entry_hash FROM admin_action_journal')) return { rows: [] };
  if (s.includes('SELECT seq FROM admin_action_journal')) return { rows: [{ seq: 1 }] };
  return { rows: [] };
}

vi.mock('../db', () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return answer(sql, params);
    },
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return answer(sql, params);
      },
      release: () => {},
    }),
  }),
}));

const INPUT = {
  firstName: 'Борис',
  lastName: 'Ким',
  email: 'boris@example.com',
  phone: '+35725000000',
  country: 'cy',
  accountType: 'standard' as const,
  password: 'correct horse battery',
  locale: 'ru' as const,
};

const find = (frag: string) => queries.find((q) => q.sql.replace(/\s+/g, ' ').includes(frag));

beforeAll(async () => {
  await import('./register');
});

beforeEach(() => {
  queries.length = 0;
  state.windowDays = 30;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ demoStartBalanceCents: 250_000, instruments: [] }))));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('регистрация: страна, IP, атрибуция', () => {
  it('страна из формы (ISO-2), IP и страна по IP — в users', async () => {
    const { registerUser } = await import('./register');
    const r = await registerUser(INPUT, { ip: '198.51.100.4', ipCountry: 'de' });
    expect(r.ok).toBe(true);
    const ins = find('INSERT INTO users')!;
    expect(ins.params.slice(5)).toEqual(['CY', '198.51.100.4', 'DE']);
    expect(find('INSERT INTO referral_attributions')).toBeUndefined();
  });

  it('first-click cookie в сроке → атрибуция рефереру той же транзакцией, промо — в источник лида', async () => {
    const { registerUser } = await import('./register');
    const clickAt = new Date(NOW.getTime() - 5 * 86_400_000);
    const r = await registerUser(INPUT, {
      cookies: { ref: encodeClick('REFCODE8', clickAt), promo: encodeClick('welcome-first-deposit', clickAt) },
      params: { ref: 'OTHER123' },
      ip: '198.51.100.4',
    });
    expect(r.ok).toBe(true);
    const attr = find('INSERT INTO referral_attributions')!;
    expect(attr.params[1]).toBe(REFERRER);
    expect(attr.params[3]).toBe('REFCODE8'); // cookie, а не параметр
    expect(attr.params[6]).toBe('active');
    const lead = find('INSERT INTO leads')!;
    expect(JSON.parse(lead.params[4] as string).source).toEqual({ promo: 'welcome-first-deposit' });
    // Атрибуция — между BEGIN и COMMIT.
    const i = queries.indexOf(attr);
    expect(queries.findIndex((q) => q.sql === 'BEGIN')).toBeLessThan(i);
    expect(queries.findIndex((q) => q.sql === 'COMMIT')).toBeGreaterThan(i);
  });

  it('cookie старше срока из настроек — не действует (параметра нет — атрибуции нет)', async () => {
    const { registerUser } = await import('./register');
    state.windowDays = 3;
    await registerUser(INPUT, { cookies: { ref: encodeClick('REFCODE8', new Date(NOW.getTime() - 5 * 86_400_000)) } });
    expect(find('INSERT INTO referral_attributions')).toBeUndefined();
  });

  it('самореферал (IP реферера) — атрибуция rejected с причиной', async () => {
    const { registerUser } = await import('./register');
    await registerUser(INPUT, { params: { ref: 'refcode8' }, ip: state.referrerIp });
    const attr = find('INSERT INTO referral_attributions')!;
    expect(attr.params[6]).toBe('rejected');
    expect(attr.params[7]).toBe('same_ip');
  });

  it('настроек акций нет — регистрация проходит без атрибуции (срок не выдумываем)', async () => {
    const { registerUser } = await import('./register');
    state.windowDays = null;
    const r = await registerUser(INPUT, { params: { ref: 'REFCODE8' } });
    expect(r.ok).toBe(true);
    expect(find('INSERT INTO referral_attributions')).toBeUndefined();
  });
});
