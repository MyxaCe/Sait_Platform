import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../migrations');

function migrations(): { name: string; text: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(DIR, name), 'utf8') }));
}

describe('системные операторы в миграциях', () => {
  it('id каждого system:* уникален', () => {
    const seen = new Map<string, string>();
    const row = /\(\s*'([0-9a-f-]{36})'\s*,\s*'(system:[a-z-]+)'/gi;
    for (const m of migrations()) {
      for (const [, id, login] of m.text.matchAll(row)) {
        const prev = seen.get(id!);
        expect(prev, `${m.name}: ${login} повторяет id ${id} (${prev})`).toBeUndefined();
        seen.set(id!, `${login} в ${m.name}`);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('последний CHECK роли операторов содержит все роли (вкл. support_operator)', () => {
    let last: string | null = null;
    for (const m of migrations()) {
      for (const [, list] of m.text.matchAll(/operators_role_check\s+CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)/gi)) {
        last = list!;
      }
    }
    expect(last).not.toBeNull();
    for (const role of ['admin', 'operator', 'finance_operator', 'support_operator']) {
      expect(last).toContain(`'${role}'`);
    }
  });
});
