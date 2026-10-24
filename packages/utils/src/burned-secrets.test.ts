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

export function burnedIn(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      // Предупреждение, называющее секрет, — не нарушение.
      if (t.startsWith('#') || t.startsWith('//') || t.startsWith('*') || t.startsWith('>')) {
        return false;
      }
      return BURNED.some((b) => line.includes(b));
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

      for (const line of burnedIn(readFileSync(file, 'utf8'))) {
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
});
