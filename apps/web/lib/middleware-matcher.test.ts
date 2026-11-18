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

describe('matcher middleware витрины', () => {
  it.each(['/', '/instruments', '/company/contacts', '/register', '/en/instruments/EURUSD', '/promotions'])(
    'страница %s проходит через middleware',
    (p) => expect(matcher().test(p)).toBe(true),
  );
  it.each(['/api/revalidate', '/_next/static/x.js', '/sw.js', '/icons/icon-192.png', '/manifest.webmanifest'])(
    '%s — мимо middleware',
    (p) => expect(matcher().test(p)).toBe(false),
  );
});
