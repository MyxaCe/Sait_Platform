import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

/**
 * WEB-16 · набор файлов прогона доходит до компонентов.
 *
 * **Зачем отдельная проверка на настройку.** Шаблон, не совпавший ни с
 * чем, даёт безупречно зелёный прогон, который не смотрит никуда, — и
 * это не выдумка про запас: ровно так витрина и жила. Окружение `node`,
 * в наборе только `.test.ts`, компонентных проверок нет вовсе, прогон
 * зелёный. Сломать это обратно можно одной строкой в настройке, и ни
 * один тест бы не покраснел: он бы просто перестал существовать.
 *
 * Проверяется поэтому не «тесты проходят», а **что им есть куда
 * попасть**: в наборе есть образец для `.tsx`, браузерное окружение
 * назначено именно ему, и на диске лежит хотя бы один такой файл.
 */

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

    // Пустой список — ровно то состояние, из которого WEB-16 выводил.
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
