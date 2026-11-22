import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CABINET = path.resolve(__dirname, '..');

function instrumentation(): string {
  return readFileSync(path.join(CABINET, 'instrumentation.ts'), 'utf8');
}

function code(): string {
  return instrumentation()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('гейт схемы кабинета', () => {
  it('подключён — модуль импортируется', () => {
    expect(code()).toMatch(/import\(['"]\.\/schema-gate['"]\)/);
  });

  it('и вызывается, а не только импортируется', () => {
    expect(code()).toMatch(/assertSchemaKnown\(\)/);
  });

  it('стоит ВНУТРИ ветки nodejs, а не снаружи', () => {
    const text = code();
    const branch = text.indexOf("process.env.NEXT_RUNTIME === 'nodejs'");
    const call = text.indexOf('./schema-gate');

    expect(branch, 'ветки nodejs в файле нет').toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(branch);
  });

  it('сам модуль гейта на месте и отказывает выходом', () => {
    const gate = readFileSync(path.join(CABINET, 'schema-gate.ts'), 'utf8');

    expect(gate).toContain('assertSchemaCurrent');
    expect(gate).toContain('process.exit(1)');
  });

  it('`pg` не импортируется в самой инструментации', () => {
    expect(code()).not.toMatch(/^import .*['"]pg['"]/m);
  });
});
