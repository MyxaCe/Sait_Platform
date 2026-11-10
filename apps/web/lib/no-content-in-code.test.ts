import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Контента в коде нет (решение владельца 10.11, `_brain/ДЕМО-контент-из-CMS-аудит.md`).
 *
 * **Что было.** Здесь жил тест «no-unverifiable-claims»: он искал
 * запрещённые утверждения (лицензии, регуляторы, «млн трейдеров», «с 2009»)
 * в data-файлах контента. Data-файлы удалены, и тест смотрел бы в пустые
 * места — зелёный по неверной причине. Сам контент теперь живёт в CMS, а
 * проверка запрещённых утверждений должна жить там же, где контент:
 *
 *   ЗАМЕТКА ДЛЯ CMS v2: валидатор уже есть — `cms/src/modules/design/forbidden-claims.ts`
 *   (хук на сохранение). В legacy CMS его нет: тексты, которые этот тест
 *   запрещал, в базе legacy лежат до сих пор (аудит, §0 п.2). Перенос
 *   словаря `BANNED_CLAIMS` ниже в валидатор v2 — задача OPS-10.
 *
 * **Что проверяется теперь.**
 *  1. Data-файлов контента нет — ни прежних, ни новых по тому же образцу.
 *  2. Подмены фикстурами нет: ни `cms-mock`, ни mock-API `/api/cms/*`.
 *  3. Контентных ключей нет в словарях интерфейса (`messages`).
 *  4. Строки бренда нет в исходниках витрины и кабинета (кроме тестов).
 *  5. Остаток: SEO- и страничные тексты пока в `messages` (до CMS v2) —
 *     на них старый словарь запрещённых утверждений продолжает действовать.
 */

const WEB = path.resolve(__dirname, '..');
const CABINET = path.resolve(WEB, '../cabinet');
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'e2e', 'playwright-report', 'test-results', 'public']);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (CODE_EXT.has(path.extname(entry))) out.push(full);
  }
  return out;
}

const isTest = (file: string) => /\.(test|spec)\.[cm]?[tj]sx?$/.test(file);
const rel = (file: string) => path.relative(WEB, file).split(path.sep).join('/');

describe('data-файлов контента в коде нет', () => {
  const REMOVED = [
    'lib/cms-mock.ts',
    'app/api/cms/[...path]/route.ts',
    'features/analytics/news-data.ts',
    'features/analytics/calendar-data.ts',
    'features/blog/posts-data.ts',
    'features/education/articles-data.ts',
    'features/education/faq-data.ts',
    'features/education/glossary-data.ts',
    'features/education/webinars-data.ts',
    'features/legal/documents.ts',
    'features/accounts/plans.ts',
  ];

  it.each(REMOVED)('%s удалён', (file) => {
    expect(existsSync(path.join(WEB, file))).toBe(false);
  });

  it('новых data-файлов по тому же образцу нет (*-data.ts, *.data.ts, fixtures/)', () => {
    const offenders = sourceFiles(WEB)
      .filter((f) => !isTest(f))
      .map(rel)
      .filter((f) => /(^|\/)[^/]+[-.]data\.tsx?$/.test(f) || /(^|\/)(fixtures|mocks?)\//.test(f));
    expect(offenders).toEqual([]);
  });

  it('словари messages не импортируются кодом напрямую (так строились фикстуры)', () => {
    // Законный путь к словарям — next-intl (`i18n/request.ts`). Прямой
    // импорт JSON был способом собрать из словаря «ответ CMS».
    const offenders = sourceFiles(WEB)
      .filter((f) => !isTest(f) && /\.[cm]?[tj]sx?$/.test(f))
      .filter((f) => rel(f) !== 'i18n/request.ts')
      .filter((f) => /from ['"]@\/messages\/|from ['"](\.\.?\/)+messages\//.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('контентных ключей в словарях интерфейса нет', () => {
  // Ресурсы CMS, которые прежде дублировались в messages и служили фикстурами
  const CONTENT_KEYS = [
    'footer.columns',
    'footer.riskWarning',
    'promotions.promos',
    'partners.models',
    'partners.tiers',
    'partners.steps',
    'contacts.channels',
    'contacts.officesList',
    'careers.benefits',
    'careers.vacancies',
    'status.services',
    'status.incidents',
    'common.brand',
  ];

  function has(obj: unknown, dotted: string): boolean {
    let cur: unknown = obj;
    for (const part of dotted.split('.')) {
      if (cur === null || typeof cur !== 'object' || !(part in cur)) return false;
      cur = (cur as Record<string, unknown>)[part];
    }
    return true;
  }

  it.each(['ru', 'en'])('messages/%s.json', (locale) => {
    const messages = JSON.parse(readFileSync(path.join(WEB, `messages/${locale}.json`), 'utf8'));
    expect(CONTENT_KEYS.filter((k) => has(messages, k))).toEqual([]);
  });
});

describe('строки бренда в коде нет — бренд приходит из CMS', () => {
  const BRAND = /apex\s*capital|apexcapital/i;

  it('скан доходит до файлов (не зелен из-за пустого обхода)', () => {
    expect(sourceFiles(WEB).length).toBeGreaterThan(50);
    expect(sourceFiles(CABINET).length).toBeGreaterThan(50);
  });

  it.each([
    ['витрина', WEB],
    ['кабинет', CABINET],
  ])('%s', (_name, root) => {
    const offenders = sourceFiles(root)
      .filter((f) => !isTest(f))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => BRAND.test(line))
          .map(({ line, i }) => `${path.relative(root, f)}:${i + 1}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});

/**
 * Остаток до CMS v2: тексты страниц и SEO пока в `messages`. Словарь —
 * прежний; когда тексты уедут в CMS v2, он переезжает в её валидатор.
 */
const BANNED_CLAIMS: RegExp[] = [
  /лиценз/i,
  /licen[cs]e/i,
  /регулируем/i,
  /regulated (broker|in)/i,
  /\b(CySEC|FSCA|FCA|ASIC)\b/,
  /млн трейдер|миллион(а|ов)? трейдер|million traders/i,
  /млрд \$|\bbn \$|\$\d+ ?(млрд|bn)/i,
  /с 2009|since 2009|foundingDate/i,
  /сегрегированн|segregated/i,
];

function offendingClaims(text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (BANNED_CLAIMS.some((re) => re.test(line))) out.push(`${i + 1}: ${trimmed}`);
  });
  return out;
}

describe('остаток текстов в messages — без неподтверждаемых заявлений', () => {
  it('детектор ловит регуляторные и масштабные заявления', () => {
    expect(offendingClaims('"badge": "Регулируемый брокер · на рынке с 2009 года"')).toHaveLength(1);
    expect(offendingClaims('"registerSubtitle": "Join 1.2 million traders"')).toHaveLength(1);
    expect(offendingClaims('// foundingDate убран')).toHaveLength(0);
  });

  it.each(['messages/ru.json', 'messages/en.json'])('%s', (file) => {
    expect(offendingClaims(readFileSync(path.join(WEB, file), 'utf8'))).toEqual([]);
  });
});
