import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-07 · граница доступа считается в РАНТАЙМЕ, а не на сборке.
 *
 * **Что было.** Страницы инструментов звали `getTenantAccess()` и
 * рендерились статически. На сборке окружения нет, граница отвечает
 * `not-configured`, список пустеет — и объяснение «список недоступен»
 * запекается в разметку. На живом домене это вечная ложная авария.
 *
 * Та же природа, что у адресов в WEB-22: состояние среды, замороженное
 * на сборке. Макет витрины от этого вылечили ещё в октябре островком;
 * страницы остались.
 *
 * **Почему проверкой по тексту.** Поведением это не ловится ничем: в
 * тестах окружение есть, функция исправна, страница рендерится. Разница
 * видна только в том, КОГДА её вызвали, а «когда» не наблюдаемо изнутри
 * вызова. Ровно тот же класс, что «вызывается не там» у каталога.
 */

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

/** Код без комментариев: объяснение рядом называет функцию по имени. */
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
    // Зелёный тест, не показавший, что умеет краснеть, за проверку не
    // считается.
    const withAccess = "const a = await getTenantAccess();";
    const withBoth = `export const dynamic = 'force-dynamic';\n${withAccess}`;

    expect(code(withAccess).includes("dynamic = 'force-dynamic'")).toBe(false);
    expect(code(withBoth).includes("dynamic = 'force-dynamic'")).toBe(true);

    // И объявление, оставшееся только в комментарии, за объявление не
    // сходит: именно так проверка по сырому тексту однажды и зеленела.
    const onlyComment = `// export const dynamic = 'force-dynamic'\n${withAccess}`;
    expect(code(onlyComment).includes("dynamic = 'force-dynamic'")).toBe(false);
  });
});
