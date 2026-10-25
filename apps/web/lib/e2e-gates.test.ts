import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-30 · пропуск сквозной проверки объявляется, а не случается.
 *
 * **Чем опасен пропуск.** В сводке он почти неотличим от прохождения:
 * прогон зелёный, строка есть, цвет спокойный. Пока возможности нет —
 * это честно. Но в прогоне, который **должен был** сценарий покрыть,
 * пропуск неотличим от успеха, и покрытие существует только на
 * словах.
 *
 * **Почему проверка по тексту.** Наблюдаемого следствия у забытого
 * гейта нет вовсе: сценарий просто не идёт, и прогон зелёный. Это
 * ровно тот случай, когда текст — единственное, что видит пропуск.
 *
 * **И смотрит она на множество ДЕЙСТВУЮЩИХ, а не написанных.** Не «во
 * всех ли файлах есть строка», а «каждый ли пропуск по окружению
 * прошёл через общий уклад». Новый файл, заведённый мимо, краснит
 * проверку с первого дня — а глазами его не найти: он ещё не
 * существует.
 */

const E2E = path.resolve(__dirname, '../e2e');

function specs(): { file: string; code: string }[] {
  return readdirSync(E2E)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => ({ file: f, code: readFileSync(path.join(E2E, f), 'utf8') }));
}

/** Строки с прямым `test.skip(...)`, упоминающие окружение. */
export function rawEnvSkips(code: string): string[] {
  return code
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    .filter((l) => /test\.skip\s*\(/.test(l) && /process\.env|_URL\b/.test(l))
    .map((l) => l.trim());
}

describe('WEB-30 · гейты сквозных сценариев', () => {
  it('скан нашёл сценарии, а не пустоту', () => {
    const found = specs();

    expect(found.length).toBeGreaterThan(3);
    expect(found.some((s) => s.file === 'mds-live.spec.ts')).toBe(true);
  });

  it.each(specs().map((s) => s.file))(
    '%s не пропускает по окружению в обход общего уклада',
    (file) => {
      const code = specs().find((s) => s.file === file)!.code;

      expect(
        rawEnvSkips(code),
        `${file}: пропуск по окружению мимо requireOrSkip/skipAsOtherScenario`,
      ).toEqual([]);
    },
  );

  it('каждый гейтованный сценарий называет переменную «обязан»', () => {
    // Без неё пропуск нечем превратить в отказ, и долг остаётся
    // невидимым.
    const required = specs()
      .filter((s) => s.code.includes('requireOrSkip'))
      .map((s) => ({ file: s.file, has: /required:\s*'[A-Z0-9_]+_REQUIRED'/.test(s.code) }));

    expect(required.length).toBeGreaterThan(2);
    expect(required.filter((r) => !r.has)).toEqual([]);
  });

  it('уклад один — вынесен, а не скопирован', () => {
    const helper = readFileSync(path.join(E2E, 'support/gates.ts'), 'utf8');

    expect(helper).toContain('requireOrSkip');
    expect(helper).toContain('skipAsOtherScenario');

    // Собственный `beforeAll`-отказ в спеке означал бы вторую копию
    // правила, которая разойдётся с первой при первой же правке.
    for (const { file, code } of specs()) {
      expect(code, `${file} держит свою копию отказа`).not.toMatch(
        /beforeAll\([\s\S]{0,200}НЕ ПРОВЕРЕН/,
      );
    }
  });

  it('проверка умеет краснеть и молчать', () => {
    expect(rawEnvSkips("  test.skip(!process.env.MDS_E2E, 'нет');")).toHaveLength(1);
    expect(rawEnvSkips("  test.skip(!CABINET_URL, 'нет');")).toHaveLength(1);

    // Пропуск без окружения — законный: вьюпорт, браузер, платформа.
    expect(rawEnvSkips("  test.skip(!isMobile, 'только мобильный');")).toEqual([]);
    // Проход через уклад — не прямой skip.
    expect(rawEnvSkips("  requireOrSkip({ gated: !process.env.MDS_E2E, ... });")).toEqual([]);
  });
});
