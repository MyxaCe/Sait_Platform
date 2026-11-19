import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectLiveParams, renderLiveParams, resetLiveParamWarnings, resolveLiveContent, substituteLiveParams } from './resolve';
import type { LiveSnapshot } from './snapshot';

const snapshot: LiveSnapshot = {
  money: { minDepositMinor: 1000, minWithdrawMinor: 1000, unverifiedWithdrawBps: 500 },
  portfolios: [
    {
      key: 'standard',
      title: 'Standard',
      baseLeverage: 20,
      classOverrides: { crypto: 10 },
      markupBps: 0,
      commissionBps: 0,
      isDefault: true,
      isPublic: true,
      sortOrder: 10,
      instruments: null,
      description: null,
    },
  ],
  support: { alwaysOpen: true, timezone: 'UTC', week: {} },
  promo: null,
  promotions: null,
};

const faq = {
  sections: [
    {
      title: 'Пополнение',
      items: [
        { question: 'Минимум?', answer: 'Минимальная сумма — {{deposit.min}}, вывод — {{ withdraw.min }}.' },
        { question: 'Плечо?', answer: '{{account.standard.name}}: {{account.standard.leverage}}, крипта {{account.standard.leverage.crypto}}.' },
      ],
    },
  ],
  total: 2,
  draft: false,
  updatedAt: null,
};

const plain = (s: string) => s.replace(/[  ]/g, ' ');

beforeEach(() => resetLiveParamWarnings());

describe('обход ресурса', () => {
  it('находит параметры на любой глубине', () => {
    expect([...collectLiveParams(faq)].sort()).toEqual([
      'account.standard.leverage',
      'account.standard.leverage.crypto',
      'account.standard.name',
      'deposit.min',
      'withdraw.min',
    ]);
  });

  it('не трогает не-строки и строки без параметров', () => {
    const out = substituteLiveParams(faq, () => 'X');
    expect(out.total).toBe(2);
    expect(out.draft).toBe(false);
    expect(out.updatedAt).toBeNull();
    expect(out.sections[0]!.title).toBe('Пополнение');
    expect(out).not.toBe(faq);
    expect(faq.sections[0]!.items[0]!.answer).toContain('{{deposit.min}}');
  });

  it('одиночные скобки и разметка не считаются параметром', () => {
    expect(collectLiveParams('{deposit.min} {{ }} {{deposit min}}').size).toBe(0);
  });
});

describe('подстановка', () => {
  it('ru и de — значения по языку страницы', () => {
    const ru = renderLiveParams(faq, { locale: 'ru', snapshot, startBalanceCents: null, labels: null });
    expect(plain(ru.sections[0]!.items[0]!.answer)).toBe('Минимальная сумма — 10 USDT, вывод — 10 USDT.');
    expect(ru.sections[0]!.items[1]!.answer).toBe('Standard: 1:20, крипта 1:10.');
  });

  it('неизвестный параметр — тире и одно предупреждение на параметр', () => {
    const warn = vi.fn();
    const data = ['{{bonus.max}} и {{bonus.max}}', '{{bonus.max}}'];
    const ctx = { locale: 'ru', snapshot, startBalanceCents: null, labels: null };
    expect(renderLiveParams(data, ctx, warn)).toEqual(['— и —', '—']);
    renderLiveParams(data, ctx, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('{{bonus.max}}');
  });

  it('настройки недоступны — тире, а не прежнее значение', () => {
    const warn = vi.fn();
    const before = renderLiveParams('{{deposit.min}}', { locale: 'ru', snapshot, startBalanceCents: null, labels: null }, warn);
    expect(plain(before)).toBe('10 USDT');
    const after = renderLiveParams('{{deposit.min}}', { locale: 'ru', snapshot: null, startBalanceCents: null, labels: null }, warn);
    expect(after).toBe('—');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('недоступен');
  });
});

describe('источники грузятся только по надобности', () => {
  it('ресурс без параметров — ни одного запроса', async () => {
    const load = vi.fn(async () => snapshot);
    const data = { items: [{ title: 'Без цифр' }] };
    expect(await resolveLiveContent(data, 'ru', { snapshot: load })).toBe(data);
    expect(load).not.toHaveBeenCalled();
  });

  it('демо-баланс — только карточка сайта, без базы', async () => {
    const load = vi.fn(async () => snapshot);
    const out = await resolveLiveContent('{{demo.startBalance}}', 'de', { snapshot: load, startBalanceCents: async () => 1_000_000 });
    expect(plain(out)).toBe('10.000 USD');
    expect(load).not.toHaveBeenCalled();
  });

  it('часы поддержки берут подпись из словаря приложения', async () => {
    const labels = vi.fn(async (locale: string) => ({ supportAlwaysOpen: locale === 'fr' ? '24 h/24' : '?' }));
    expect(await resolveLiveContent('{{support.hours}}', 'fr', { snapshot: async () => snapshot, labels })).toBe('24 h/24');
    expect(labels).toHaveBeenCalledWith('fr');
  });

  it('источник упал — тире, исключение наружу не выходит', async () => {
    const warn = vi.fn();
    const out = await resolveLiveContent(
      { a: '{{deposit.min}}', b: '{{account.standard.leverage}}' },
      'ru',
      {
        snapshot: async () => {
          throw new Error('db down');
        },
      },
      warn,
    );
    expect(out).toEqual({ a: '—', b: '—' });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
