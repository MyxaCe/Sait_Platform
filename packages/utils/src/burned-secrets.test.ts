import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сожжённые отладочные секреты не возвращаются в примеры и документацию.
 *
 * `deploy` нашёл их в публичной истории репозитория: с августа они лежат
 * там и останутся — история не переписывается. На сервере не
 * используется ни один, перевыпускать нечего, но **годными они больше не
 * считаются ни при каких «для теста»**: взятое «на время» остаётся.
 *
 * **Что именно запрещено.** Не упоминание — упоминать их в
 * предупреждении нужно, иначе предупреждение безымянное. Запрещено
 * приводить их как значение, которое предлагается взять: в примерах
 * окружения и в документации.
 *
 * **Первая редакция различала это по знаку комментария — и покрасила
 * main.** «Предупреждением» считалась строка, начинающаяся с `#`, `//`,
 * `*` или `>`. В файле окружения и в коде так и есть, а в Markdown
 * запрет — обычная проза: запись в реестре задач, называвшая четыре
 * значения, чтобы объяснить, почему их больше нельзя брать, попала под
 * собственного сторожа. Правило было верным, реализация — уже правила,
 * и красила она ровно тот текст, ради которого писалась.
 *
 * Различать надо не комментарий, а **форму присваивания**: `KEY=value`,
 * `KEY: value`, `--flag value`. Названное в прозе имя к использованию
 * не предлагается. В `.env.example` остаётся строгий разбор: там всякая
 * не-комментарная строка и есть присваивание, и послабление было бы
 * дырой.
 *
 * **Локальный компоуз — названное исключение.** Это самодостаточный
 * стенд: службам надо сойтись на одном значении, данных в нём нет, а
 * замена на генерацию сломала бы «поднял и работает». Исключение
 * названо здесь, а не подразумевается, и в самом файле стоит
 * предупреждение.
 */

const ROOT = path.resolve(__dirname, '../../..');

/** Значения, сожжённые публикацией истории. */
const BURNED = [
  'broker_dev_password',
  'dev-cms-api-key',
  'local-dev-secret',
  'preview-dev-secret',
  'dev-payload-secret',
];

/** Где значение читается как «возьмите это». */
const WATCHED = ['.env.example', '.md'];

/** Стенд, которому эти значения служат внутренней договорённостью. */
const ALLOWED = ['docker-compose.yml'];

const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', '.git', 'coverage']);

function watchedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...watchedFiles(full));
    else if (WATCHED.some((w) => entry.endsWith(w))) out.push(full);
  }
  return out;
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('#') || t.startsWith('//') || t.startsWith('*') || t.startsWith('>');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Стоит ли значение в форме присваивания — то есть предлагается ли оно
 * к использованию, а не просто названо.
 *
 * Кавычки и обратные апострофы вокруг значения допускаются: в
 * документации его обычно оформляют кодом.
 */
export function offeredAsValue(line: string, burned: string): boolean {
  const re = new RegExp(`(=|:\\s|\\s--?[A-Za-z0-9-]+[=\\s])\\s*['"\`]?[^\\s'"\`]*${escapeRe(burned)}`);
  return re.test(line);
}

/**
 * @param strict `.env.example` и прочие примеры окружения: там всякая
 * не-комментарная строка есть присваивание, и упоминание вне
 * присваивания невозможно. Для `.md` — разбор по форме.
 */
export function burnedIn(text: string, strict = true): string[] {
  return text
    .split('\n')
    .filter((line) => {
      // Предупреждение, называющее секрет, — не нарушение.
      if (isCommentLine(line)) return false;
      const hit = BURNED.find((b) => line.includes(b));
      if (!hit) return false;
      return strict || offeredAsValue(line, hit);
    })
    .map((l) => l.trim());
}

describe('сожжённые секреты не предлагаются к использованию', () => {
  it('скан находит примеры и документацию', () => {
    const files = watchedFiles(ROOT);

    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith('.env.example'))).toBe(true);
  });

  it('ни в одном примере и ни в одном документе', () => {
    const offenders: string[] = [];

    for (const file of watchedFiles(ROOT)) {
      const relative = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWED.some((a) => relative.endsWith(a))) continue;

      // В прозе Markdown имя можно называть; в примере окружения — нет.
      const strict = !relative.endsWith('.md');
      for (const line of burnedIn(readFileSync(file, 'utf8'), strict)) {
        offenders.push(`${relative}: ${line}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('проверка умеет краснеть', () => {
    expect(
      burnedIn('# DATABASE_URL=postgres://broker:broker_dev_password@localhost:5432/x'),
    ).toEqual([]);
    expect(burnedIn('DATABASE_URL=postgres://broker:broker_dev_password@localhost:5432/x')).toHaveLength(
      1,
    );
    expect(burnedIn('CMS_API_KEY=dev-cms-api-key')).toHaveLength(1);
  });

  /**
   * Послабление для Markdown — место, где сторож легче всего мог бы
   * ослепнуть совсем. Поэтому обе стороны проверяются порознь: что
   * проза проходит И что предложение значения всё ещё ловится.
   */
  describe('в Markdown различается называние и предложение', () => {
    const md = (line: string) => burnedIn(line, false);

    it('названное в прозе имя — не нарушение', () => {
      expect(md('`dev-cms-api-key`, `local-dev-secret`, `preview-dev-secret`,')).toEqual([]);
      expect(md('Значение `broker_dev_password` сожжено и годным не считается.')).toEqual([]);
      expect(md('Секреты dev-payload-secret-… лежат в истории с августа.')).toEqual([]);
    });

    it('предложенное как значение — нарушение, в любой огранке', () => {
      expect(md('CMS_API_KEY=dev-cms-api-key')).toHaveLength(1);
      expect(md('    CMS_API_KEY=dev-cms-api-key')).toHaveLength(1);
      expect(md('CMS_API_KEY: dev-cms-api-key')).toHaveLength(1);
      expect(md('CMS_API_KEY: `dev-cms-api-key`')).toHaveLength(1);
      expect(md('export CMS_API_KEY="dev-cms-api-key"')).toHaveLength(1);
      expect(md('psql --password broker_dev_password')).toHaveLength(1);
      expect(md('docker run -e CMS_API_KEY=dev-cms-api-key image')).toHaveLength(1);
      expect(
        md('DATABASE_URL=postgres://broker:broker_dev_password@localhost:5432/x'),
      ).toHaveLength(1);
    });

    it('строгий разбор примеров окружения послаблением не задет', () => {
      // Та же строка, что в прозе законна, в `.env.example` — нарушение.
      expect(burnedIn('`dev-cms-api-key`', true)).toHaveLength(1);
    });
  });
});
