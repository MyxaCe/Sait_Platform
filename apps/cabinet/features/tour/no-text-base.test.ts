import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * В пресете Tailwind есть цвет `base` (= фон страницы). Поэтому класс `text-base` задаёт
 * не только размер шрифта, но и цвет фона: текст без своего цвета становится почти чёрным
 * на тёмной карточке (так пропал заголовок экскурсии). В кабинете размер «1rem» пишем как
 * `text-[1rem]`, а `text-base` не используем.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' || name === '.next' ? [] : files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('кабинет без text-base', () => {
  it('нигде в features/ и app/ нет класса text-base', () => {
    const root = join(__dirname, '..', '..');
    const offenders = [...files(join(root, 'features')), ...files(join(root, 'app'))].filter((f) =>
      /(^|[\s"'`])text-base([\s"'`]|$)/m.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
