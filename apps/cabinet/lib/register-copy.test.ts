import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ru from '../messages/ru.json';
import en from '../messages/en.json';
import { registerSubtitle } from './register-copy';
import { START_BALANCE_UNAVAILABLE } from '@broker/tenant';

/**
 * CAB-06: «$10 000» в подписи регистрации — обещание, которого мы не
 * даём.
 *
 * **Почему это не косметика.** Сумму назначает владелец сайта полем
 * `demoStartBalanceCents`, и `registerAccount()` при незаданной сумме
 * ОТКАЗЫВАЕТ открывать счёт (Р-040 отменил прежний фолбэк «$10 000,
 * параметр удобства ничего не разрешает»). То есть подпись обещала
 * сумму ровно в том состоянии, в котором код на этой же сумме
 * отказывал: человек видел обещание, проходил форму и получал отказ.
 *
 * **Что проверяется отдельно от логики — сами тексты.** Зашитая сумма
 * жила в файле переводов, и никакой тест функции её бы не нашёл:
 * функция-то исправна. Поэтому ниже есть проверка по СОДЕРЖИМОМУ
 * словарей, и она же сторожит перевод, который добавят завтра.
 */

const CABINET = path.resolve(__dirname, '..');

describe('registerSubtitle · сумма называется только назначенная', () => {
  it('сумма назначена → подпись с суммой из конфига', () => {
    const choice = registerSubtitle({ state: 'set', cents: 1_000_000 }, 'en');

    expect(choice.key).toBe('registerSubtitleWithAmount');
    expect(choice).toHaveProperty('amount', '$10,000.00');
  });

  it('другая сумма тенанта — другая подпись: число НЕ зашито', () => {
    // Растяжка против «вернули $10 000 как константу, но через функцию».
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
    // Главное утверждение задачи: никакого числа наружу.
    expect(choice).not.toHaveProperty('amount');
  });

  it('состояние `unset` тоже молчит о сумме', () => {
    // `unset` — владелец оставил поле пустым СОЗНАТЕЛЬНО. Это настройка,
    // а не поломка, но обещать от этого нечего ровно так же.
    const choice = registerSubtitle({ state: 'unset' }, 'ru');

    expect(choice).toEqual({ key: 'registerSubtitle' });
  });
});

describe('в текстах кабинета нет зашитых сумм', () => {
  /**
   * Проверка по содержимому словарей, а не по коду. Зашитая сумма —
   * это строка в переводах, и поймать её можно только там. Класс
   * «написано в данных» модульным тестом функции не ловится в принципе.
   */
  const dictionaries: [string, unknown][] = [
    ['ru', ru],
    ['en', en],
  ];

  it.each(dictionaries)('словарь %s не обещает конкретную сумму', (_locale, dict) => {
    const serialized = JSON.stringify(dict);

    // Денежная сумма из четырёх и более цифр с разделителем или без.
    // Исключение — подстановка `{amount}`: она и есть правильный способ
    // назвать сумму.
    const moneyLike = /[$€£]\s?\d[\d\s,. ]{2,}/g;
    const found = serialized.match(moneyLike) ?? [];

    expect(found).toEqual([]);
  });

  it('подпись с суммой существует в обоих словарях и несёт подстановку', () => {
    // Иначе «починка» свелась бы к удалению ключа, и страница упала бы
    // на отсутствующем переводе в тот момент, когда сумма ЕСТЬ, —
    // то есть в самом обычном состоянии.
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
    // Снятие вызова не красит ни одного обычного теста: функция
    // осталась бы исправной, её просто перестали бы звать. Этот класс
    // мы меряли трижды — ноль модульных тестов каждый раз.
    const page = readFileSync(
      path.join(CABINET, 'app/[locale]/(auth)/register/page.tsx'),
      'utf8',
    );

    expect(page).toContain('getTenantStartBalance');
    expect(page).toContain('registerSubtitle');
  });
});
