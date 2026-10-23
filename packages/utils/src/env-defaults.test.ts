import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-21 · умолчание к окружению не ставят через `??`.
 *
 * `process.env.X ?? '…'` ловит `undefined` и **пропускает пустую
 * строку**, а пустая берётся сама собой: пустой аргумент сборки
 * перекрывает умолчание Dockerfile, `X=` в `.env`, незаполненная
 * подстановка в компоузе. Наружу это вышло нерабочими кнопками входа.
 *
 * **Почему проверкой по тексту.** Поведением это не ловится: код
 * исправен, значение «есть», тип `string`. Чтобы покраснело, нужен
 * прогон с ПУСТОЙ переменной — а такого никто не ставит, потому что
 * пустая переменная не выглядит состоянием, которое стоит проверять.
 *
 * **Почему отдельный файл от сторожа подстановки нуля.** Инвариант
 * другой и ищется другим выражением: там «ноль на охраняемой
 * величине», здесь «умолчание к окружению». Складывать их в один
 * реестр значило бы завести реестр с двумя смыслами. Живут рядом, в
 * одном пакете: здесь место правилам, которые проверяются по исходнику.
 *
 * **Область — витрина, кабинет и пакеты**, как назвал штаб. В релее и
 * консюмере тот же узор есть (шесть мест), но они не зависят от
 * `@broker/utils`, и тянуть туда зависимость — расширение задачи за
 * названные зоны. Вынесено штабу отдельно, а не починено молча.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SCAN = ['apps/web', 'apps/cabinet', 'packages'];
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);
const CODE_EXT = new Set(['.ts', '.tsx']);

/** `process.env.X ?? …` — умолчание, которое пустую строку пропускает. */
const ENV_NULLISH_DEFAULT = /process\.env\.[A-Za-z_][A-Za-z0-9_]*\s*\?\?/;

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

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

describe('WEB-21 · пустая строка не проходит за незаданное', () => {
  it('скан доходит до файлов, а не зелен из-за пустого обхода', () => {
    // Р-101 к себе: сломанный корень дал бы ноль файлов и безупречно
    // зелёную проверку, которая не смотрит никуда.
    const scanned = SCAN.flatMap((d) => sourceFiles(path.join(ROOT, d)));

    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned.some((f) => f.includes('SiteHeader'))).toBe(true);
  });

  it('ни одного `process.env.X ??` в витрине, кабинете и пакетах', () => {
    const offenders: string[] = [];

    for (const dir of SCAN) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        if (path.basename(file) === 'env-defaults.test.ts') continue;

        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (isComment(line)) return;
            if (ENV_NULLISH_DEFAULT.test(line)) {
              offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('проверка умеет краснеть — иначе она зелёная просто так', () => {
    const caught = (line: string) => !isComment(line) && ENV_NULLISH_DEFAULT.test(line);

    expect(caught("const u = process.env.NEXT_PUBLIC_CABINET_URL ?? 'http://localhost:3002';")).toBe(
      true,
    );
    expect(caught('  environment: process.env.SENTRY_ENV ?? "test",')).toBe(true);

    // Честные записи не трогает.
    expect(caught("const u = envOr(process.env.NEXT_PUBLIC_CABINET_URL, 'http://x');")).toBe(false);
    expect(caught('const key = process.env.CMS_API_KEY || undefined;')).toBe(false);
    expect(caught("if (!process.env.MDS_HTTP_URL) return 'not-configured';")).toBe(false);
    expect(caught("    // было process.env.X ?? '…' — так нельзя")).toBe(false);
  });
});
