import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function matcher(): RegExp {
  const src = readFileSync(path.resolve(__dirname, '../middleware.ts'), 'utf8');
  const m = /matcher:\s*\[\s*('(?:[^'\\]|\\.)*')\s*\]/.exec(src);
  expect(m, 'matcher не найден').not.toBeNull();
  const value = new Function(`return ${m![1]}`)() as string;
  return new RegExp(`^${value}$`);
}

describe('matcher middleware кабинета', () => {
  it.each(['/', '/login', '/de/login', '/wallet', '/en/profile', '/fr/terminal'])('страница %s проходит через middleware', (p) =>
    expect(matcher().test(p)).toBe(true),
  );
  it.each(['/api/sso/launch', '/_next/static/x.js', '/favicon.ico'])('%s — мимо middleware', (p) =>
    expect(matcher().test(p)).toBe(false),
  );
});
