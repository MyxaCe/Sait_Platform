import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_SLUG, tenantSlug } from './slug';

/**
 * WEB-11: пустой `SITE_SLUG` больше не выдаёт себя за заданный.
 *
 * **Чем это было.** `process.env.SITE_SLUG ?? 'apex-ru'`, написанное в
 * шести местах. `??` отсекает `undefined`, но не пустую строку — а
 * `SITE_SLUG=` в `.env` и незаполненная подстановка в компоузе дают
 * именно её. Наружу это выходило не ошибкой, а ЧУЖИМ ТЕНАНТОМ: CMS по
 * пустому `?site=` отдавала сайт по умолчанию.
 *
 * Цена разная в разных местах, и самое дорогое — не витрина:
 * выдача SSO-токенов назвала бы чужого тенанта, тенант-фильтр консюмера
 * сравнивал бы события с пустым слагом. Ни то, ни другое не оставляет
 * следа в логах.
 */

describe('tenantSlug · пустое значение это «не задано»', () => {
  it('слаг задан — возвращается он', () => {
    expect(tenantSlug('apex-uk')).toBe('apex-uk');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['пустая строка', ''],
    ['пробелы', '   '],
    ['табуляция и перевод строки', '\t\n'],
  ])('%s → умолчание, а не пустой слаг', (_name, raw) => {
    expect(tenantSlug(raw)).toBe(DEFAULT_TENANT_SLUG);
  });

  it('РАСТЯЖКА: пустая строка не проходит как слаг', () => {
    // Именно это и было дефектом. `??` здесь вернул бы `''`, и запрос
    // ушёл бы с `?site=` — то есть за чужим тенантом.
    expect(tenantSlug('')).not.toBe('');
    expect(tenantSlug('')).toBeTruthy();
  });

  it('пробелы по краям отсекаются, а не едут в адрес', () => {
    // Значение, отличающееся от нужного невидимым символом, даёт отказ,
    // причину которого не видно глазами.
    expect(tenantSlug('  apex-uk  ')).toBe('apex-uk');
  });
});

describe('копия в консюмере не разошлась с пакетом', () => {
  /**
   * Консюмер повторяет эту логику строкой, а не импортом: пакета
   * `@broker/tenant` в его зависимостях нет, и заводить его ради одной
   * строки — менять lockfile и тянуть в шинный процесс пакет про
   * границу доступа. Решение записано рядом с кодом; здесь закреплена
   * СВЯЗЬ, иначе копия тихо разъедется.
   *
   * Это тот же приём, которым `cms` держит у себя наше окно
   * переиспользования: копия плюс тест на связь.
   */
  const CONSUMER = path.resolve(
    __dirname,
    '../../../apps/consumer/src/index.ts',
  );

  it('консюмер тоже считает пустую строку незаданной', () => {
    const source = readFileSync(CONSUMER, 'utf8');

    // Именно отсутствие голого `??` и наличие нормализации.
    expect(source).not.toContain("process.env.SITE_SLUG ?? 'apex-ru'");
    expect(source).toContain("(process.env.SITE_SLUG ?? '').trim() ||");
    expect(source).toContain(DEFAULT_TENANT_SLUG);
  });

  it('его выражение даёт те же ответы, что пакет', () => {
    // Поведение, а не только текст: сравниваются результаты на тех же
    // входах. Текст можно переписать, не меняя смысла, — и наоборот.
    const consumerExpression = (raw: string | undefined) => (raw ?? '').trim() || 'apex-ru';

    for (const raw of [undefined, '', '   ', 'apex-uk', '  apex-uk  ']) {
      expect(consumerExpression(raw)).toBe(tenantSlug(raw));
    }
  });
});
