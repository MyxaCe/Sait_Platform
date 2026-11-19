import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ draftMode: () => ({ isEnabled: false }) }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: string }) => (key: string) =>
    key === 'supportAlwaysOpen' ? (locale === 'de' ? 'rund um die Uhr' : 'круглосуточно') : key,
}));

const FAQ = {
  sections: [
    {
      title: 'Пополнение',
      items: [
        { question: 'Минимум?', answer: 'Минимум — {{deposit.min}}, без KYC — до {{withdraw.unverifiedPercent}}.' },
        { question: 'Плечо?', answer: '{{account.pro.name}} — до {{account.pro.leverage}}. Поддержка {{support.hours}}.' },
        { question: 'Демо?', answer: 'На демо {{demo.startBalance}}.' },
      ],
    },
  ],
};

const LIVE = {
  live: {
    money: { minDepositMinor: 1000, minWithdrawMinor: 1000, unverifiedWithdrawBps: 500 },
    portfolios: [
      {
        key: 'pro',
        title: 'Pro',
        baseLeverage: 50,
        classOverrides: {},
        markupBps: 0,
        commissionBps: 0,
        isDefault: false,
        isPublic: true,
        sortOrder: 20,
        instruments: null,
        description: null,
      },
    ],
    support: { alwaysOpen: true, timezone: 'UTC', week: {} },
    promo: null,
    promotions: [],
  },
};

let dir: string;

beforeAll(async () => {
  await import('./cms');
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cms-live-'));
  vi.stubEnv('CMS_LAST_GOOD_DIR', dir);
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
  vi.stubEnv('CABINET_INTERNAL_URL', 'http://cabinet.test');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

function stub(cabinet: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('http://cabinet.test/')) return cabinet();
      if (url.includes('/cms/sites/')) return Response.json({ demoStartBalanceCents: 1_000_000, instruments: [] });
      return Response.json(FAQ);
    }),
  );
}

const answers = (data: typeof FAQ) => data.sections[0]!.items.map((i) => i.answer.replace(/[  ]/g, ' '));

describe('getCms подставляет живые параметры', () => {
  it('ru', async () => {
    stub(() => Response.json(LIVE));
    const { getCms } = await import('./cms');
    expect(answers(await getCms('faq', { locale: 'ru' }))).toEqual([
      'Минимум — 10 USDT, без KYC — до 5 %.',
      'Pro — до 1:50. Поддержка круглосуточно.',
      'На демо 10 000 USD.',
    ]);
  });

  it('de — формат по языку страницы', async () => {
    stub(() => Response.json(LIVE));
    const { getCms } = await import('./cms');
    expect(answers(await getCms('faq', { locale: 'de' }))).toEqual([
      'Минимум — 10 USDT, без KYC — до 5 %.',
      'Pro — до 1:50. Поддержка rund um die Uhr.',
      'На демо 10.000 USD.',
    ]);
  });

  it('кабинет недоступен — тире вместо цифр платформы, страница не падает', async () => {
    stub(() => new Response('{}', { status: 503 }));
    const { getCms } = await import('./cms');
    expect(answers(await getCms('faq', { locale: 'ru' }))).toEqual([
      'Минимум — —, без KYC — до —.',
      '— — до —. Поддержка —.',
      'На демо 10 000 USD.',
    ]);
  });
});
