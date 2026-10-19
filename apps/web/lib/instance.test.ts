import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFingerprint, configFingerprint, instanceIdentity } from './instance';

/**
 * B-019: health-ручка обязана называть ЭКЗЕМПЛЯР, а не приложение, и
 * сообщать, ЧТО задано, никогда не сообщая, что именно в нём лежит.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('instanceIdentity · признак, который экземпляр не выбирает себе сам', () => {
  it('host берётся у системы, а не из константы в коде', () => {
    vi.spyOn(os, 'hostname').mockReturnValue('container-7f3a91');
    expect(instanceIdentity().host).toBe('container-7f3a91');
  });

  it('pid — настоящий pid процесса', () => {
    expect(instanceIdentity().pid).toBe(process.pid);
  });

  it('startedAt считается из uptime, а не замерзает на сборке (B-010)', () => {
    // Значение обязано ехать вместе с процессом: при разном uptime — разное
    vi.spyOn(process, 'uptime').mockReturnValue(10);
    const early = instanceIdentity().startedAt;
    vi.spyOn(process, 'uptime').mockReturnValue(10_000);
    const late = instanceIdentity().startedAt;
    expect(early).not.toBe(late);
    expect(new Date(late).getTime()).toBeLessThan(new Date(early).getTime());
  });

  it('два экземпляра одного приложения различимы по host+pid', () => {
    vi.spyOn(os, 'hostname').mockReturnValue('host-a');
    const a = instanceIdentity();
    vi.spyOn(os, 'hostname').mockReturnValue('host-b');
    const b = instanceIdentity();
    // Ровно то, чего не хватало: service у обоих был бы одинаков
    expect(`${a.host}:${a.pid}`).not.toBe(`${b.host}:${b.pid}`);
  });
});

describe('configFingerprint · отпечаток, а не значения', () => {
  it('заданная переменная → true, незаданная → false', () => {
    vi.stubEnv('CMS_API_URL', 'https://cms.example.test');
    vi.stubEnv('DATABASE_URL', '');
    const fp = configFingerprint();
    expect(fp.CMS_API_URL).toBe(true);
    expect(fp.DATABASE_URL).toBe(false);
  });

  it('пустая строка считается «не задано» — она и ведёт себя как отсутствие', () => {
    vi.stubEnv('PREVIEW_SECRET', '');
    expect(configFingerprint().PREVIEW_SECRET).toBe(false);
  });

  it('ЗНАЧЕНИЯ не попадают в ответ ни одной переменной', () => {
    const secrets = {
      CMS_API_KEY: 'key-b4d51e',
      CMS_WEBHOOK_SECRET: 'whsec-9910aa',
      PREVIEW_SECRET: 'prev-77c1',
      DATABASE_URL: 'postgres://user:hunter2@db:5432/broker',
      SENTRY_DSN: 'https://abc123@glitchtip.example.test/2',
    };
    for (const [k, v] of Object.entries(secrets)) vi.stubEnv(k, v);

    const serialized = JSON.stringify(configFingerprint());
    for (const value of Object.values(secrets)) {
      expect(serialized).not.toContain(value);
    }
    // и ни одного фрагмента: пароль из DATABASE_URL тоже не должен светиться
    expect(serialized).not.toContain('hunter2');
  });

  it('значения — строго булевы, никаких строк не просочится и в будущем', () => {
    vi.stubEnv('CMS_API_KEY', 'key-b4d51e');
    for (const value of Object.values(configFingerprint())) {
      expect(typeof value).toBe('boolean');
    }
  });

  it('список отпечатка закреплён — расширяется только осознанно', () => {
    // Покрыты РАНТАЙМОВЫЕ переменные из таблицы docs/Локальный запуск.md.
    // Вне списка сознательно: всё, что действует по природе сборки
    // (FRAME_ANCESTORS, BUILD_STANDALONE и NEXT_PUBLIC_*, впекаемые в
    // браузерный бандл), — их снимок живёт в configBuild, а здесь
    // отпечаток соврал бы «не задано» о действующем значении (B-030).
    // SENTRY_ENV — косметика; CABINET_URL/TERMINAL_URL/MDS_E2E — только e2e.
    // Новая рантаймовая переменная обязана попасть и сюда, и в таблицу —
    // падение этого теста и есть напоминание
    const keys = Object.keys(configFingerprint()).sort();
    expect(keys).toEqual(
      [
        'ALLOW_SENTRY_TEST',
        'CMS_API_KEY',
        'CMS_API_URL',
        'CMS_WEBHOOK_SECRET',
        'DATABASE_URL',
        'MDS_HTTP_URL',
        'NEXT_PUBLIC_WS_URL',
        'PREVIEW_SECRET',
        'SENTRY_DSN',
        'SITE_SLUG',
      ].sort(),
    );
  });

  it('РАСТЯЖКА: сборочных переменных в рантаймовом отпечатке нет ни одной', () => {
    // Именно это и было дефектом B-030: поле отпечатка утверждало «нет»
    // про значение, вшитое в бандл. Тот, кто решит «вернуть полезное
    // поле», увидит здесь причину, по которой его там быть не может:
    // чтение тут динамическое, компилятор его не инлайнит, и увидеть
    // сборочное значение этот список НЕ МОЖЕТ в принципе.
    const keys = Object.keys(configFingerprint());

    for (const buildScoped of [
      'NEXT_PUBLIC_CABINET_URL',
      'NEXT_PUBLIC_SITE_URL',
      'NEXT_PUBLIC_SENTRY_DSN',
      'FRAME_ANCESTORS',
      'BUILD_STANDALONE',
    ]) {
      expect(keys).not.toContain(buildScoped);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Отпечаток СБОРКИ (WEB-09, B-030)                                     */
/* ------------------------------------------------------------------ */

describe('buildFingerprint · факт сборки отдаётся как факт сборки', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('снимок разобран — отдаётся как есть', () => {
    vi.stubEnv(
      'BUILD_CONFIG_FINGERPRINT',
      JSON.stringify({ NEXT_PUBLIC_CABINET_URL: true, FRAME_ANCESTORS: false }),
    );

    expect(buildFingerprint()).toEqual({
      NEXT_PUBLIC_CABINET_URL: true,
      FRAME_ANCESTORS: false,
    });
  });

  it('снимка нет → null, а НЕ пустой объект', () => {
    // «Образ собран без снимка» (старая сборка) и «на сборке ничего не
    // было задано» — разные факты. Пустой объект выдал бы первое за
    // второе, то есть повторил бы ровно тот дефект, который чиним.
    vi.stubEnv('BUILD_CONFIG_FINGERPRINT', '');

    expect(buildFingerprint()).toBeNull();
    expect(buildFingerprint()).not.toEqual({});
  });

  it.each([
    ['не JSON', 'не json'],
    ['JSON, но массив', '[1,2]'],
    ['JSON, но null', 'null'],
    ['значение не булево', '{"NEXT_PUBLIC_CABINET_URL":"true"}'],
  ])('%s → null: непонятое не превращается в «не задано»', (_name, raw) => {
    // Строка "true" — не булево. Мягкое приведение здесь дало бы
    // правдоподобный ответ про значение, которого мы не поняли.
    vi.stubEnv('BUILD_CONFIG_FINGERPRINT', raw);

    expect(buildFingerprint()).toBeNull();
  });

  it('отпечаток остаётся булевым — значения не утекают', () => {
    vi.stubEnv(
      'BUILD_CONFIG_FINGERPRINT',
      JSON.stringify({ NEXT_PUBLIC_CABINET_URL: true }),
    );

    for (const value of Object.values(buildFingerprint() ?? {})) {
      expect(typeof value).toBe('boolean');
    }
  });
});
