import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(__dirname, '../app');

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (entry === 'page.tsx' || entry === 'route.ts') out.push(full);
  }
  return out;
}

const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('WEB-07 · граница доступа не замерзает на сборке', () => {
  it('скан находит страницы', () => {
    expect(pages(APP).length).toBeGreaterThan(5);
  });

  it('каждая страница, спрашивающая границу доступа, объявлена динамической', () => {
    const offenders: string[] = [];

    for (const file of pages(APP)) {
      const text = code(readFileSync(file, 'utf8'));
      if (!text.includes('getTenantAccess')) continue;
      if (!text.includes("dynamic = 'force-dynamic'")) {
        offenders.push(path.relative(APP, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('проверка умеет краснеть', () => {
    const withAccess = "const a = await getTenantAccess();";
    const withBoth = `export const dynamic = 'force-dynamic';\n${withAccess}`;

    expect(code(withAccess).includes("dynamic = 'force-dynamic'")).toBe(false);
    expect(code(withBoth).includes("dynamic = 'force-dynamic'")).toBe(true);

    const onlyComment = `// export const dynamic = 'force-dynamic'\n${withAccess}`;
    expect(code(onlyComment).includes("dynamic = 'force-dynamic'")).toBe(false);
  });
});
