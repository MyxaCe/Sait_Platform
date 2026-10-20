import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertTenantSlugAtStartup,
  MissingTenantSlugError,
  readTenantSlug,
  requireTenantSlug,
} from './slug';

/**
 * PKG-05: приложение, не знающее своего тенанта, не обслуживает.
 *
 * **Чем это было.** `process.env.SITE_SLUG ?? 'apex-ru'` в шести местах.
 * `??` не отсекает пустую строку, а CMS по пустому `?site=` отдаёт сайт
 * по умолчанию. Остальные умолчания платформы подставлялись в то, что
 * ВИДНО; это подставлялось **в личность** — в то, от чьего имени мы
 * действуем, — и следа не оставляло ни на экране, ни в логе.
 *
 * **Две функции, а не одна, и это решение.** Есть законный случай, где
 * слага нет и это не авария: сборка. Образ один на много тенантов,
 * `SITE_SLUG` назначается при запуске. Поэтому `readTenantSlug` даёт
 * `null` (вызывающий закроет границу fail-closed), а `requireTenantSlug`
 * бросает — и вызывающий выбирает осознанно, какой ему нужен.
 */

const ROOT = path.resolve(__dirname, '../../..');

describe('readTenantSlug · что считается заданным', () => {
  it('слаг задан — возвращается он', () => {
    expect(readTenantSlug('apex-uk')).toBe('apex-uk');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['пустая строка', ''],
    ['пробелы', '   '],
    ['табуляция и перевод строки', '\t\n'],
  ])('%s → null, то есть «не задано»', (_name, raw) => {
    expect(readTenantSlug(raw)).toBeNull();
  });

  it('РАСТЯЖКА: умолчания больше нет ни в одной ветке', () => {
    // Прежняя версия возвращала здесь 'apex-ru'. Тот, кто решит
    // «вернуть удобство», увидит этот тест: удобство означало работу от
    // чужого имени.
    expect(readTenantSlug('')).not.toBe('apex-ru');
    expect(readTenantSlug(undefined)).toBeNull();
  });

  it('пробелы по краям отсекаются, а не едут в адрес', () => {
    expect(readTenantSlug('  apex-uk  ')).toBe('apex-uk');
  });
});

describe('requireTenantSlug · там, где без имени нельзя', () => {
  it('ПАРНАЯ к отказу: заданный слаг принимается', () => {
    // К проверке «X отвергается» пишется «не-X принимается». Без неё
    // функция, отвергающая ВСЁ, прошла бы набор целиком.
    expect(requireTenantSlug('apex-uk', 'тест')).toBe('apex-uk');
  });

  it.each([
    ['undefined', undefined],
    ['пустая строка', ''],
    ['пробелы', '  '],
  ])('%s → MissingTenantSlugError, а не умолчание', (_name, raw) => {
    expect(() => requireTenantSlug(raw, 'тест')).toThrow(MissingTenantSlugError);
  });

  it('у отказа есть машинный код и названо МЕСТО', () => {
    // «SITE_SLUG не задан» без указания места заставляет искать по
    // всему репозиторию; код нужен, чтобы отличать этот отказ от любой
    // другой поломки в обработчике старта.
    try {
      requireTenantSlug('', 'выдача SSO-токена');
      expect.unreachable('должно было бросить');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingTenantSlugError);
      expect((error as MissingTenantSlugError).code).toBe('missing-tenant-slug');
      expect((error as Error).message).toContain('выдача SSO-токена');
    }
  });
});

describe('assertTenantSlugAtStartup · гейт процесса', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('слаг задан — возвращается и годится для лога запуска', () => {
    vi.stubEnv('SITE_SLUG', 'apex-uk');

    expect(assertTenantSlugAtStartup('старт')).toBe('apex-uk');
  });

  it('слага нет — бросает', () => {
    vi.stubEnv('SITE_SLUG', '');

    expect(() => assertTenantSlugAtStartup('старт')).toThrow(MissingTenantSlugError);
  });
});

/* ------------------------------------------------------------------ */
/* Проводка: гейт стоит у каждого, кто обслуживает тенанта             */
/* ------------------------------------------------------------------ */

describe('проводка гейта по приложениям', () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

  /**
   * Код без комментариев. Объяснение, ЧТО здесь стояло раньше и почему
   * убрано, обязано лежать рядом с кодом и называть прежнее выражение
   * дословно — иначе следующий вернёт «удобство», не зная цены. Без
   * вычистки комментариев пришлось бы выбирать между проверяемым
   * правилом и записанным намерением.
   */
  const code = (rel: string) =>
    read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it.each([
    ['витрина', 'apps/web/instrumentation.ts'],
    ['кабинет', 'apps/cabinet/instrumentation.ts'],
    ['консюмер', 'apps/consumer/src/index.ts'],
  ])('%s ЗОВЁТ гейт на старте, а не только импортирует его', (_name, file) => {
    /**
     * Проверяется ВЫЗОВ, со скобкой. Первая версия искала голое имя
     * `assertTenantSlugAtStartup` — и мутация «снять вызов из
     * `register()`» покрасила **ноль**: строка импорта содержит то же
     * имя, и проверка проходила на приложении, которое гейт больше не
     * зовёт.
     *
     * Это ровно тот класс, который проводка и должна ловить, —
     * «написано и не вызывается», — и первая версия теста ловила его
     * собственный импорт вместо вызова.
     */
    const src = code(file);

    expect(src).toContain('assertTenantSlugAtStartup(');
    // И сам вызов не закомментирован: `code()` комментарии уже снял.
    expect(src.split('assertTenantSlugAtStartup(').length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['витрина', 'apps/web/instrumentation.ts'],
    ['кабинет', 'apps/cabinet/instrumentation.ts'],
  ])('%s зовёт гейт ИЗ register(), а не просто объявляет функцию', (_name, file) => {
    // Объявить `assertTenantKnown` и не позвать её из `register()` —
    // то же «написано и не вызывается», этажом выше.
    const src = code(file);
    const register = src.slice(src.indexOf('export async function register'));

    expect(register).toContain('assertTenantKnown()');
  });

  it('гейт у Next НЕ срабатывает на фазе сборки', () => {
    // Образ один на много тенантов: слаг приходит из `environment` при
    // запуске. Требовать его на сборке значит завести гейт, который
    // невозможно удовлетворить, — а такие отключают.
    for (const file of ['apps/web/instrumentation.ts', 'apps/cabinet/instrumentation.ts']) {
      expect(read(file)).toContain('phase-production-build');
    }
  });

  it('РЕЛЕЙ гейта не имеет — и это решение, а не пропуск', () => {
    // У релея нет понятия тенанта: он публикует outbox, тенант лежит
    // внутри события, и компоуз контура SITE_SLUG ему не задаёт.
    // Гейт здесь остановил бы исправный сервис ради единообразия.
    const relay = read('apps/relay/src/index.ts');

    expect(relay).not.toContain('assertTenantSlugAtStartup');
    expect(relay).not.toContain('SITE_SLUG');
  });

  it('умолчания apex-ru не осталось НИ В ОДНОМ приложении', () => {
    // Умолчание убирается из всех дверей сразу, иначе вернётся через
    // оставшуюся.
    const doors = [
      'apps/web/lib/cms.ts',
      'apps/web/lib/tenant.ts',
      'apps/cabinet/lib/tenant.ts',
      'apps/cabinet/lib/chrome.ts',
      'apps/cabinet/lib/sso/jwt.ts',
      'apps/consumer/src/index.ts',
    ];

    for (const file of doors) {
      expect(code(file)).not.toContain("?? 'apex-ru'");
      expect(code(file)).not.toContain("|| 'apex-ru'");
      expect(code(file)).not.toContain("'apex-ru'");
    }
  });

  it('кабинет НЕ собирает адрес CMS без слага', () => {
    // `?site=` — не «без фильтра», а «сайт по умолчанию»: CMS ответила
    // бы 200 с чужим брендом. Строка запроса, собранная из пустого
    // значения, выглядит исправной — это и делает её опасной.
    const chrome = read('apps/cabinet/lib/chrome.ts');

    expect(chrome).toContain('if (slug === null)');
    expect(chrome).toContain('encodeURIComponent(slug)');
  });
});
