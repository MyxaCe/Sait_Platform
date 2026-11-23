import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const E2E = path.resolve(__dirname, '../e2e');

function specs(): { file: string; code: string }[] {
  return readdirSync(E2E)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => ({ file: f, code: readFileSync(path.join(E2E, f), 'utf8') }));
}

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
    expect(found.some((s) => s.file === 'instruments.spec.ts')).toBe(true);
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

    for (const { file, code } of specs()) {
      expect(code, `${file} держит свою копию отказа`).not.toMatch(
        /beforeAll\([\s\S]{0,200}НЕ ПРОВЕРЕН/,
      );
    }
  });

  it('проверка умеет краснеть и молчать', () => {
    expect(rawEnvSkips("  test.skip(!process.env.MDS_E2E, 'нет');")).toHaveLength(1);
    expect(rawEnvSkips("  test.skip(!CABINET_URL, 'нет');")).toHaveLength(1);

    expect(rawEnvSkips("  test.skip(!isMobile, 'только мобильный');")).toEqual([]);
    expect(rawEnvSkips("  requireOrSkip({ gated: !process.env.MDS_E2E, ... });")).toEqual([]);
  });
});
