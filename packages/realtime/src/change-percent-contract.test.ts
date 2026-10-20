import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Запрет подстановки нуля вместо пустого `changePercent` — проверкой по
 * исходнику, а не по поведению.
 *
 * Почему так, а не обычным тестом: подстановка нуля в отборе ведёт себя
 * **неотличимо** от честного условия. `(x ?? 0) > 0` и `x !== null && x > 0`
 * дают один и тот же результат на любых данных — это проверено мутацией, все
 * тесты остались зелёными. Компилятор тоже молчит: `?? 0` типобезопасен.
 *
 * То есть у правила «ноль не подставляем» (КОНТРАКТЫ.md, Р-118) нет
 * наблюдаемых последствий ровно до того момента, когда оно нарушено в месте,
 * где последствия есть, — например на крупной цифре страницы инструмента,
 * где `?? 0` показывал уверенное «0.00%». Поймать это можно только на уровне
 * текста программы, поэтому проверка смотрит в текст.
 *
 * Зона витрины вдобавок не умеет тестировать компоненты вовсе: в
 * `apps/web/vitest.config.ts` окружение `node` и включены только `.test.ts`.
 * Пока это так, подобная правка в `.tsx` ничем другим не прикрыта.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['apps', 'packages'];
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', '.git', 'coverage']);
const CODE_EXT = new Set(['.ts', '.tsx']);

/** `changePercent ?? 0`, `changePercent || 0` и варианты с `?.` и пробелами. */
const ZERO_SUBSTITUTION = /changePercent\s*(?:\?\?|\|\|)\s*0(?!\d|\.\d*[1-9])/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (CODE_EXT.has(path.extname(entry))) out.push(full);
  }
  return out;
}

describe('changePercent · ноль вместо пустого значения не подставляют (Р-118)', () => {
  it('ни в одном файле витрины, кабинета и пакетов нет `changePercent ?? 0`', () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        // Файл проверки называет запрещённый образец сам — иначе он бы себя же
        // и поймал. Поэтому исключение по имени, а не по содержимому.
        if (path.basename(file) === 'change-percent-contract.test.ts') continue;

        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (ZERO_SUBSTITUTION.test(line)) {
              offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('сама проверка ловит образец — иначе она зелёная просто так', () => {
    // Тест на тест: без этого строчка выше осталась бы зелёной и после того,
    // как регулярное выражение однажды перестало бы что-либо находить.
    expect(ZERO_SUBSTITUTION.test('<PriceChange value={quote?.changePercent ?? 0} />')).toBe(true);
    expect(ZERO_SUBSTITUTION.test('const c = q.changePercent || 0;')).toBe(true);
    expect(ZERO_SUBSTITUTION.test('filter((q) => (q.changePercent ?? 0) > 0)')).toBe(true);

    // А честные записи не трогает.
    expect(ZERO_SUBSTITUTION.test('value={quote?.changePercent ?? null}')).toBe(false);
    expect(ZERO_SUBSTITUTION.test('q.changePercent !== null && q.changePercent > 0')).toBe(false);
  });
});
