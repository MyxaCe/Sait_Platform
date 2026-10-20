import { describe, expect, it, vi } from 'vitest';

/**
 * QA-05 · «спред 0, комиссия 0» в запасных фикстурах — это «торговля
 * бесплатна» (Р-086).
 *
 * Запасные фикстуры отдаются ровно тогда, когда настоящая CMS недоступна,
 * то есть когда сверить цену не с чем. Утверждение о **цене торговли**,
 * сделанное в такой момент на странице тарифов, — обещание, которого мы
 * не даём.
 *
 * **И отличить подставленный ноль было бы нельзя:** у тарифа Standard
 * комиссия — настоящий ноль ($0 в его же признаках). Тот же класс, что
 * `changePercent`: выдуманное значение совпадает с законным и потому
 * невидимо.
 *
 * Отдельный файл, потому что подмена `ACCOUNT_PRICING` нужна на уровне
 * модуля и не должна влиять на контрактный набор в `cms-mock.test.ts`.
 */

vi.mock('@/features/accounts/plans', async () => {
  const actual =
    await vi.importActual<typeof import('@/features/accounts/plans')>('@/features/accounts/plans');
  return {
    ...actual,
    // Тариф `pro` остался без цены — ровно то, что случится, когда кто-то
    // заведёт новый тариф и забудет внести его в прайс.
    ACCOUNT_PRICING: actual.ACCOUNT_PRICING.filter((p) => p.id !== 'pro'),
  };
});

/** Билдер в реестре объявлен опциональным — достаём его явно, без `!`. */
async function accountsBuilder() {
  const { CMS_MOCK } = await import('./cms-mock');
  const build = CMS_MOCK.accounts;
  if (!build) throw new Error('в CMS_MOCK нет билдера accounts — тест смотрит не туда');
  return build;
}

describe('cms-mock · тариф без цены', () => {
  it('отказывает, а не публикует нулевую цену', async () => {
    const build = await accountsBuilder();

    expect(() => build('ru', new URLSearchParams())).toThrow(/ACCOUNT_PRICING/);
  });

  it('в сообщении назван виновный тариф — иначе искать его по всем', async () => {
    // Отказ называет место (родня Р-101, где ассерт печатает полученное):
    // «что-то не так с ценами» отправляет перебирать тарифы руками.
    const build = await accountsBuilder();

    expect(() => build('ru', new URLSearchParams())).toThrow(/pro/);
  });

  it('тарифы с ценой при этом остаются корректными', async () => {
    // Растяжка: отказ должен быть точечным. Если бы падало всё подряд,
    // проверка выше была бы зелёной и при полностью сломанном прайсе.
    const actual = await vi.importActual<typeof import('@/features/accounts/plans')>(
      '@/features/accounts/plans',
    );

    expect(actual.ACCOUNT_PRICING.find((p) => p.id === 'standard')?.commissionPerLotRT).toBe(0);
  });
});
