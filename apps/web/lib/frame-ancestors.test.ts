import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = path.resolve(__dirname, '..');
const ROOT = path.resolve(WEB, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const withoutComments = (text: string) =>
  text
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('#');
    })
    .join('\n');

describe('WEB-23 · умолчание списка встраивающих — «никому»', () => {
  it('в коде умолчание `none`, а не разрешающий список', () => {
    const code = withoutComments(readFileSync(path.join(WEB, 'next.config.mjs'), 'utf8'));

    expect(code).toContain("\"'none'\"");
    expect(code).not.toMatch(/\?\?\s*"'self'/);
  });

  it('пустая строка считается отсутствием, а не значением', () => {
    const code = withoutComments(readFileSync(path.join(WEB, 'next.config.mjs'), 'utf8'));

    expect(code).toMatch(/\.trim\(\)/);
    expect(code).toMatch(/length > 0/);
  });

  it('в образ идёт плейсхолдер, а не адрес', () => {
    const dockerfile = withoutComments(read('docker/web.Dockerfile'));

    expect(dockerfile).toContain('ENV FRAME_ANCESTORS=https://runtime-frame-ancestors.invalid');
    expect(dockerfile).not.toMatch(/ARG FRAME_ANCESTORS/);
  });

  it('плейсхолдер безопасен сам по себе: промах подстановки никого не пускает', () => {
    expect('https://runtime-frame-ancestors.invalid').toMatch(/\.invalid$/);
  });

  it('подстановщик знает про безопасное умолчание', () => {
    const script = read('docker/runtime-config.sh');

    expect(script).toContain("FRAME_ANCESTORS|fallback:'none'");
  });

  it('значение со списком не склеивается: берём printenv, а не eval', () => {
    const script = withoutComments(read('docker/runtime-config.sh'));

    expect(script).toContain('printenv');
    expect(script).not.toMatch(/eval printf/);
  });
});
