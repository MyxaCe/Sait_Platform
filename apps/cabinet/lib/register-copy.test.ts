import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ru from '../messages/ru.json';
import en from '../messages/en.json';
import { registerSubtitle } from './register-copy';
import { START_BALANCE_UNAVAILABLE } from '@broker/tenant';

const CABINET = path.resolve(__dirname, '..');

describe('registerSubtitle · сумма называется только назначенная', () => {
  it('сумма назначена → подпись с суммой из конфига', () => {
    const choice = registerSubtitle({ state: 'set', cents: 1_000_000 }, 'en');

    expect(choice.key).toBe('registerSubtitleWithAmount');
    expect(choice).toHaveProperty('amount', '$10,000.00');
  });

  it('другая сумма тенанта — другая подпись: число НЕ зашито', () => {
    const choice = registerSubtitle({ state: 'set', cents: 2_500_00 }, 'en');

    expect(choice).toHaveProperty('amount', '$2,500.00');
  });

  it.each([
    ['не задана владельцем', START_BALANCE_UNAVAILABLE['not-configured']],
    ['CMS не ответила', START_BALANCE_UNAVAILABLE['network']],
    ['CMS ответила мусором', START_BALANCE_UNAVAILABLE['malformed']],
  ])('%s → подпись БЕЗ суммы, а не с выдуманной', (_name, startBalance) => {
    const choice = registerSubtitle(startBalance, 'ru');

    expect(choice).toEqual({ key: 'registerSubtitle' });
    expect(choice).not.toHaveProperty('amount');
  });

  it('состояние `unset` тоже молчит о сумме', () => {
    const choice = registerSubtitle({ state: 'unset' }, 'ru');

    expect(choice).toEqual({ key: 'registerSubtitle' });
  });
});

describe('в текстах кабинета нет зашитых сумм', () => {
  const dictionaries: [string, unknown][] = [
    ['ru', ru],
    ['en', en],
  ];

  it.each(dictionaries)('словарь %s не обещает конкретную сумму', (_locale, dict) => {
    const serialized = JSON.stringify(dict);

    const moneyLike = /[$€£]\s?\d[\d\s,. ]{2,}/g;
    const found = serialized.match(moneyLike) ?? [];

    expect(found).toEqual([]);
  });

  it('подпись с суммой существует в обоих словарях и несёт подстановку', () => {
    for (const [, dict] of dictionaries) {
      const auth = (dict as { auth: Record<string, string> }).auth;

      expect(auth.registerSubtitleWithAmount).toContain('{amount}');
      expect(auth.registerSubtitle).toBeTruthy();
      expect(auth.registerSubtitle).not.toContain('{amount}');
    }
  });
});

describe('проводка: страница спрашивает тенанта, а не подставляет своё', () => {
  it('страница регистрации зовёт конфиг тенанта и общий выбор подписи', () => {
    const page = readFileSync(
      path.join(CABINET, 'app/[locale]/(auth)/register/page.tsx'),
      'utf8',
    );

    expect(page).toContain('getTenantStartBalance');
    expect(page).toContain('registerSubtitle');
  });
});
