import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CAB-07 · ноль не подставляют вместо срока жизни — проверкой по исходнику.
 *
 * **Почему не обычным тестом.** Поведенческий тест этого класса не ловит:
 * ручка отдаёт срок, пришедший от выпуска, и `handoff.expiresIn ?? 0`
 * оставил бы все проверки зелёными — настоящее число не ноль, подстановка
 * не срабатывает ни на одном пути, который тест проходит. Сработает она
 * ровно тогда, когда срока не будет, то есть в единственном случае, ради
 * которого вся задача и заведена. Компилятор тоже молчит: `?? 0`
 * типобезопасен.
 *
 * **Почему именно здесь.** Это не абстрактная осторожность, а зеркало чужой
 * починки: у терминала стояло `(d.expires_in || 0)`, и пустой срок
 * превращался в «истекла только что» — терминал просил новый токен раз в
 * секунду, бесконечно (TRM-24). Умолчание на границе времени не показывает
 * неправду, оно **производит работу**: со стороны соседа это исправно
 * работающий клиент, и найти такое можно только по его счётчикам.
 *
 * Со стороны кабинета зеркальная ошибка выглядела бы как «назвали ноль
 * секунд» — терминал, по контракту продлевающий сессию ДО истечения, не
 * примет сессию вовсе (Р-100, fail-closed), и человек не войдёт.
 *
 * Парный тест на саму проверку обязателен: проверка, разучившаяся находить,
 * остаётся зелёной и неотличима от исправной.
 */

const ROOT = path.resolve(__dirname, '../..');
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);
const CODE_EXT = new Set(['.ts', '.tsx']);

/**
 * Нарушение — это ДВА признака на одной строке: подстановка нуля и то, что
 * строка вообще про срок.
 *
 * Первая редакция требовала идентификатор вплотную к оператору
 * (`expiresIn ?? 0`) и на мутации пропустила `tokenLifetimeSeconds(token) ?? 0`
 * — ноль подставлен к результату вызова, и имени перед оператором нет. Это
 * показала мутация, а не парный тест: парный проверял те образцы, которые я
 * придумала, а мутация — тот, который настоящий.
 */
const ZERO_DEFAULT = /(?:\?\?|\|\|)\s*0(?!\d|\.\d*[1-9])/;

/**
 * Длинные слова ищутся подстрокой (попадают и в camelCase:
 * `tokenLifetimeSeconds`), короткое и многозначное `exp` — только отдельным
 * словом, иначе в сеть попали бы `expected`, `export`, `experiment`.
 */
const EXPIRY_WORD = /(?:expires|expiry|lifetime|ttl)|\bexp\b/i;

function violates(line: string): boolean {
  return ZERO_DEFAULT.test(line) && EXPIRY_WORD.test(line);
}

/** Строка целиком комментарий: `//`, `/*`, `*` продолжения JSDoc. */
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

describe('CAB-07 · ноль вместо срока жизни не подставляют', () => {
  it('ни в одном файле кабинета нет `exp ?? 0` и родни', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(ROOT)) {
      // Файл проверки называет запрещённый образец сам — иначе поймал бы себя.
      if (path.basename(file) === 'expiry-contract.test.ts') continue;

      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // Проверка смотрит на код, а не на прозу: строки-комментарии
          // пропускаем. Без этого она ловила собственный комментарий,
          // который цитирует запрещённый образец, чтобы объяснить его. Строку
          // кода с хвостовым комментарием это не прячет — она не НАЧИНАЕТСЯ
          // с комментария.
          if (isComment(line)) return;
          if (violates(line)) {
            offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }

    expect(offenders).toEqual([]);
  });

  it('проверка умеет краснеть — иначе она зелёная просто так', () => {
    // Зелёный тест, не показавший, что умеет краснеть, за проверку не
    // считается. Образцы ниже — ровно та запись, которую чинил терминал.
    expect(violates('const ttl = d.expires_in || 0;')).toBe(true);
    expect(violates('expiresIn: handoff.expiresIn ?? 0,')).toBe(true);
    expect(violates('return (payload.exp ?? 0) - payload.iat;')).toBe(true);
    expect(violates('const ttl = cfg.ttl || 0')).toBe(true);

    // Образец, который первая редакция проверки пропустила на мутации: ноль
    // подставлен к результату вызова, имени перед оператором нет.
    expect(violates('return { token, expiresIn: tokenLifetimeSeconds(token) ?? 0 };')).toBe(true);

    // И не трогает честные записи и похожие слова.
    expect(violates('if (typeof exp !== "number") throw new Error()')).toBe(false);
    expect(violates('const expected = value ?? 0;')).toBe(false);
    expect(violates('export const retries = count ?? 0;')).toBe(false);
    expect(violates('const experiment = flag ?? 0;')).toBe(false);
  });

  it('комментарии не считаются нарушением, а код с комментарием — считается', () => {
    // Первая редакция проверки поймала собственный комментарий, который
    // цитирует запрещённый образец, чтобы его объяснить. Послабление за это
    // заплачено минимальное, и граница закреплена здесь: прячет оно только
    // строку, которая НАЧИНАЕТСЯ как комментарий.
    expect(isComment('    // Было `(payload.exp ?? 0) - (payload.iat ?? 0)`')).toBe(true);
    expect(isComment('     * срок: `d.expires_in || 0` — так было у терминала')).toBe(true);

    expect(isComment('  expiresIn: handoff.expiresIn ?? 0, // временно')).toBe(false);
    expect(violates('  expiresIn: handoff.expiresIn ?? 0, // временно')).toBe(true);
  });
});
