import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-37 · ограничение пула стоит у КАЖДОГО пакета с проверками.
 *
 * **Зачем проверять настройку, а не поведение.** Пакет, забывший
 * ограничение, поднимает свой пул в `ядра − 1` потока и перегружает
 * машину за всех — а прогон при этом зелёный. Наблюдаемое следствие
 * есть, но оно вероятностное: краснеет не этот пакет и не всегда.
 * Проверка по тексту здесь не замена ненаписанной поведенческой, а
 * единственная, которая ловит причину, а не её жертв.
 *
 * **И новый пакет забудут первым.** Файла настройки у него может не
 * быть вовсе — vitest работает на умолчаниях, — поэтому проверяется не
 * «во всех файлах есть строка», а «у каждого, кто запускает проверки,
 * файл есть и ограничение в нём».
 */

const ROOT = path.resolve(__dirname, '../../..');

/** Пакеты и приложения, у которых объявлен скрипт `test`. */
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
    // Пустой список дал бы безупречно зелёную проверку ни о чём.
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
