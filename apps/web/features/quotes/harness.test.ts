import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

const WEB = path.resolve(__dirname, '../..');
const include = config.test?.include ?? [];

function tsxTests(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.turbo') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxTests(full));
    else if (entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

describe('WEB-16 · компонентные проверки действительно собираются', () => {
  it('в наборе есть образец для `.tsx`', () => {
    expect(include.some((p) => p.endsWith('.test.tsx'))).toBe(true);
  });

  it('браузерное окружение назначено `.tsx`, а узловое осталось узловым', () => {
    expect(config.test?.environment).toBe('node');
    expect(config.test?.environmentMatchGlobs).toContainEqual(['**/*.test.tsx', 'jsdom']);
  });

  it('на диске есть хотя бы один такой файл, и он под шаблоном', () => {
    const found = tsxTests(WEB).map((f) => path.relative(WEB, f).split(path.sep).join('/'));

    expect(found.length).toBeGreaterThan(0);
    for (const file of found) {
      const covered = include.some((p) => {
        const dir = p.split('/')[0];
        return p.endsWith('.test.tsx') && file.startsWith(`${dir}/`);
      });
      expect(covered, `${file} не попадает ни под один шаблон набора`).toBe(true);
    }
  });
});
