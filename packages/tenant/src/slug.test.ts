import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertTenantSlugAtStartup,
  MissingTenantSlugError,
  readTenantSlug,
  requireTenantSlug,
} from './slug';

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
    expect(readTenantSlug('')).not.toBe('apex-ru');
    expect(readTenantSlug(undefined)).toBeNull();
  });

  it('пробелы по краям отсекаются, а не едут в адрес', () => {
    expect(readTenantSlug('  apex-uk  ')).toBe('apex-uk');
  });
});

describe('requireTenantSlug · там, где без имени нельзя', () => {
  it('ПАРНАЯ к отказу: заданный слаг принимается', () => {
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

describe('проводка гейта по приложениям', () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

  const code = (rel: string) =>
    read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it.each([
    ['витрина', 'apps/web/instrumentation.ts'],
    ['кабинет', 'apps/cabinet/instrumentation.ts'],
    ['консюмер', 'apps/consumer/src/index.ts'],
  ])('%s ЗОВЁТ гейт на старте, а не только импортирует его', (_name, file) => {
    const src = code(file);

    expect(src).toContain('assertTenantSlugAtStartup(');
    expect(src.split('assertTenantSlugAtStartup(').length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['витрина', 'apps/web/instrumentation.ts'],
    ['кабинет', 'apps/cabinet/instrumentation.ts'],
  ])('%s зовёт гейт ИЗ register(), а не просто объявляет функцию', (_name, file) => {
    const src = code(file);
    const register = src.slice(src.indexOf('export async function register'));

    expect(register).toContain('assertTenantKnown()');
  });

  it('гейт у Next НЕ срабатывает на фазе сборки', () => {
    for (const file of ['apps/web/instrumentation.ts', 'apps/cabinet/instrumentation.ts']) {
      expect(read(file)).toContain('phase-production-build');
    }
  });

  it('РЕЛЕЙ гейта не имеет — и это решение, а не пропуск', () => {
    const relay = read('apps/relay/src/index.ts');

    expect(relay).not.toContain('assertTenantSlugAtStartup');
    expect(relay).not.toContain('SITE_SLUG');
  });

  it('умолчания apex-ru не осталось НИ В ОДНОМ приложении', () => {
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
    const chrome = read('apps/cabinet/lib/chrome.ts');

    expect(chrome).toContain('if (slug === null)');
    expect(chrome).toContain('encodeURIComponent(slug)');
  });
});
