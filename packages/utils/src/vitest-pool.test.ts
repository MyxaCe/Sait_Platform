import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

function packagesWithTests(): string[] {
  const out: string[] = [];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const manifest = path.join(dir, name, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.test) out.push(path.join(group, name));
    }
  }
  return out;
}

describe('WEB-37 · перегрузка машины не возвращается', () => {
  it('скан нашёл пакеты, а не пустоту', () => {
    expect(packagesWithTests().length).toBeGreaterThan(5);
  });

  it.each(packagesWithTests())('%s ограничивает пул общим источником', (pkg) => {
    const config = path.join(ROOT, pkg, 'vitest.config.ts');

    expect(existsSync(config), `нет ${pkg}/vitest.config.ts`).toBe(true);

    const text = readFileSync(config, 'utf8');
    expect(text, `${pkg} не берёт poolOptions из @broker/config`).toContain(
      "@broker/config/vitest-pool.js",
    );
    expect(text, `${pkg} не применяет poolOptions`).toMatch(/\bpoolOptions\b\s*,/);
  });

  it('источник ограничения один — и он на месте', () => {
    const shared = path.join(ROOT, 'packages/config/vitest-pool.js');

    expect(existsSync(shared)).toBe(true);
    expect(readFileSync(shared, 'utf8')).toContain('maxThreads');
  });
});
