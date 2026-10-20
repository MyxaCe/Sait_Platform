import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * QA-05 · единая проверка: ноль не подставляют вместо отсутствующего
 * значения на границах данных (Р-086).
 *
 * **Почему проверкой по тексту программы, а не тестом.** У этого запрета
 * в большинстве путей нет наблюдаемых последствий: `(x ?? 0) > 0` и
 * `x !== null && x > 0` дают один и тот же результат на любых данных —
 * проверено мутацией, набор остался зелёным. Компилятор тоже молчит:
 * `?? 0` типобезопасен. Запрет «проявляется» ровно в том единственном
 * случае, ради которого он и заведён, — когда значения нет.
 *
 * **Почему один механизм, а не список на зону.** Сторожей было два —
 * `changePercent` в витрине и срок жизни токена в кабинете, — и у обоих
 * нашлось ОДНО и то же слепое пятно. Чинить его дважды значило завести
 * третий и четвёртый производный список. Здесь список — данные
 * (`GUARDED`), добавление поля стоит одну строку.
 *
 * **Чему научила мутация.** Первые редакции требовали идентификатор
 * вплотную к оператору и пропускали `lifetimeOf(token) ?? 0`: ноль
 * подставлен к результату ВЫЗОВА, имени перед оператором нет. Показал это
 * не парный тест, а мутация — зеркало отражает воображение автора.
 * Поэтому признака два и они независимы: подстановка нуля в строке И
 * слово про охраняемую величину в той же строке.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['apps', 'packages'];
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', '.git', 'coverage']);
const CODE_EXT = new Set(['.ts', '.tsx']);

interface Guarded {
  /** Искомое слово. */
  term: string;
  /**
   * `substring` — слово различимо само по себе и ловится внутри camelCase
   * (`tokenLifetimeSeconds`). `word` — слово короткое или многозначное, и
   * без границ в сеть попадут `expected`, `export`, `randomUUID`.
   */
  match: 'substring' | 'word';
  /** Чем именно врёт здесь ноль — попадает в сообщение об ошибке. */
  why: string;
}

const GUARDED: Guarded[] = [
  {
    term: 'changePercent',
    match: 'substring',
    why: 'ноль это «цена не изменилась» — утверждение о рынке (Р-118)',
  },
  {
    term: 'expires',
    match: 'substring',
    why: 'ноль это «истекло только что» — сосед начнёт просить токен без остановки (Р-100)',
  },
  {
    term: 'lifetime',
    match: 'substring',
    why: 'ноль это «истекает немедленно» (Р-100)',
  },
  { term: 'ttl', match: 'word', why: 'ноль это «истекает немедленно» (Р-100)' },
  { term: 'exp', match: 'word', why: 'ноль это «истекло только что» (Р-100)' },
  {
    term: 'uid',
    match: 'word',
    why: '«UID 0» выглядит как настоящий номер, человек процитирует его поддержке (Р-086)',
  },
  {
    term: 'spreadPips',
    match: 'substring',
    why: 'ноль это «спред нулевой» — утверждение о цене торговли (Р-086)',
  },
  {
    term: 'commission',
    match: 'substring',
    why: 'ноль это «комиссии нет» — утверждение о цене торговли (Р-086)',
  },
];

/** `?? 0` и `|| 0`; `?? 0.5` и `?? 0x10` — не подстановка нуля. */
const ZERO_DEFAULT = /(?:\?\?|\|\|)\s*0(?!\d|\.\d*[1-9]|[xXbBoO])/;

function mentions(line: string, g: Guarded): boolean {
  return g.match === 'substring'
    ? new RegExp(g.term, 'i').test(line)
    : new RegExp(`\\b${g.term}\\b`, 'i').test(line);
}

/** Строка целиком комментарий: проверка смотрит на код, а не на прозу. */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

export function violationsIn(line: string): Guarded[] {
  if (isComment(line) || !ZERO_DEFAULT.test(line)) return [];
  return GUARDED.filter((g) => mentions(line, g));
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

describe('QA-05 · ноль не подставляют вместо отсутствующего значения', () => {
  it('скан действительно доходит до файлов, а не зелен из-за пустого обхода', () => {
    // Зелёный бывает зелёным по неверной причине (Р-101). Сломанный `ROOT`
    // или лишняя папка в `SKIP` дали бы ноль файлов и безупречно зелёную
    // проверку, которая не смотрит никуда. Порог грубый нарочно: он ловит
    // обвал обхода, а не считает файлы.
    const scanned = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)));

    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned.some((f) => f.includes('cms-mock'))).toBe(true);
    expect(scanned.some((f) => f.includes(path.join('auth', 'session')))).toBe(true);
  });

  it('ни одного `?? 0` на охраняемых величинах во всём репозитории', () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        // Файл проверки перечисляет образцы сам — иначе поймал бы себя.
        if (path.basename(file) === 'zero-substitution.test.ts') continue;

        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            for (const g of violationsIn(line)) {
              offenders.push(
                `${path.relative(ROOT, file)}:${i + 1} (${g.term}: ${g.why})\n    ${line.trim()}`,
              );
            }
          });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('проверка умеет краснеть — иначе она зелёная просто так', () => {
    // Зелёный тест, не показавший, что умеет краснеть, за проверку не
    // считается. Каждый образец — настоящая строка из тех, что мы чинили.
    const caught = (line: string) => violationsIn(line).length > 0;

    expect(caught('<PriceChange value={quote?.changePercent ?? 0} />')).toBe(true);
    expect(caught('filter((q) => (q.changePercent ?? 0) > 0)')).toBe(true);
    expect(caught('const ttl = d.expires_in || 0;')).toBe(true);
    expect(caught('return (payload.exp ?? 0) - payload.iat;')).toBe(true);
    expect(caught('uid: Number(row.uid ?? 0),')).toBe(true);
    expect(caught('spreadPips: pricing?.spreadPips ?? 0,')).toBe(true);
    expect(caught('commissionPerLotRT: pricing?.commissionPerLotRT ?? 0,')).toBe(true);

    // Образец, который прошёл мимо первых редакций: ноль подставлен к
    // результату вызова, имени перед оператором нет.
    expect(caught('return { token, expiresIn: tokenLifetimeSeconds(token) ?? 0 };')).toBe(true);
  });

  it('не ловит честные записи и похожие слова', () => {
    const caught = (line: string) => violationsIn(line).length > 0;

    // Ноль не подставляется вовсе.
    expect(caught('if (typeof exp !== "number") throw new TokenWithoutExpiryError("exp");')).toBe(
      false,
    );
    expect(caught('value={quote?.changePercent ?? null}')).toBe(false);
    expect(caught('q.changePercent !== null && q.changePercent > 0')).toBe(false);

    // Слова, лишь похожие на охраняемые.
    expect(caught('const expected = value ?? 0;')).toBe(false);
    expect(caught('export const retries = count ?? 0;')).toBe(false);
    expect(caught('const experiment = flag ?? 0;')).toBe(false);
    expect(caught('const id = randomUUID() ?? 0;')).toBe(false);

    // Подстановка НЕ нуля — не предмет этой проверки.
    expect(caught('const ttl = cfg.ttl ?? 0.5;')).toBe(false);
  });

  it('комментарий не нарушение, а код с хвостовым комментарием — нарушение', () => {
    // Первая редакция ловила собственный комментарий, цитирующий образец.
    // Послабление минимальное: прячет только строку, которая НАЧИНАЕТСЯ
    // как комментарий.
    expect(violationsIn('    // было `exp ?? 0` — так делать нельзя')).toEqual([]);
    expect(violationsIn('     * срок: `d.expires_in || 0` у терминала')).toEqual([]);

    expect(violationsIn('  expiresIn: handoff.expiresIn ?? 0, // временно').length).toBe(1);
  });

  it('реестр не пуст и у каждой записи названа причина', () => {
    // Растяжка: запись без причины превращает отказ в «нельзя, потому что
    // нельзя», а такие запреты обходят первыми.
    expect(GUARDED.length).toBeGreaterThan(0);
    for (const g of GUARDED) {
      expect(g.why.length).toBeGreaterThan(10);
    }
  });
});
