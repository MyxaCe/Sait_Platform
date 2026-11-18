import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import cases from './contracts/visibility-cases.v2.json';
import { filterNavByJurisdiction, readJurisdictions, visibilityIn } from './visibility';

const RULE_DIGEST = '1bb2c603c1c64ac59902a3f6ced063aab99a67b3cfaf1b8ad1781a9ded68e36c';

const TABLE_VERSION = 2;

function ruleOf(table: unknown): unknown {
  const t = table as Record<string, unknown>;
  return { defaults: t.defaults, reasons: t.reasons, items: t.items, trees: t.trees };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(record[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

const digestOf = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

const SOURCE_DIR = path.resolve(__dirname, '../../../../cms/src/contracts');
const SOURCE = path.join(SOURCE_DIR, `visibility-cases.v${TABLE_VERSION}.json`);

describe('эталонные случаи видимости · пункт', () => {
  it.each(cases.items.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    const verdict = visibilityIn(item.restrictions, item.jurisdiction);

    expect(verdict.visible).toBe(item.visible);
    expect(verdict.reason).toBe(item.reason);
  });

  it('охват объявлен числом И по свойствам, которые случаи закрепляют', () => {
    expect(cases.items.length).toBeGreaterThanOrEqual(19);
    expect(cases.trees.length).toBeGreaterThanOrEqual(6);

    const pins = new Set(cases.items.map((i) => i.pins));
    expect([...pins].sort()).toEqual(['comparison', 'default', 'normalization', 'reads-field']);
  });

  it('случаи на чтение формы — ОГРАНИЧИВАЮЩИЕ, иначе они ничего не проверяют', () => {
    const readsField = cases.items.filter((i) => i.pins === 'reads-field');

    expect(readsField.length).toBeGreaterThan(0);
    expect(readsField.some((i) => i.visible === false)).toBe(true);
  });
});

interface CaseNode {
  readonly label: string;
  readonly jurisdictions: readonly unknown[];
  readonly children: readonly CaseNode[];
}

interface ShapeNode {
  readonly label: string;
  readonly children: readonly ShapeNode[];
}

function shapeOf(items: readonly CaseNode[]): ShapeNode[] {
  return items.map((item) => ({ label: item.label, children: shapeOf(item.children ?? []) }));
}

describe('эталонные случаи видимости · дерево меню', () => {
  it.each(cases.trees.map((tree) => [tree.name, tree] as const))(
    'дерево: %s',
    (_name, example) => {
      const result = filterNavByJurisdiction(
        example.tree as unknown as readonly CaseNode[],
        example.jurisdiction,
      );

      expect(shapeOf(result.items)).toEqual(example.visibleTree);
      expect(result.hidden).toBe(example.hidden);
    },
  );
});

describe('копия таблицы', () => {
  it('не правлена у нас — отпечаток правила сошёлся', () => {
    expect(digestOf(ruleOf(cases))).toBe(RULE_DIGEST);
  });

  it('не разошлась с источником — либо сверка объявлена НЕВЫПОЛНЕННОЙ', (ctx) => {
    if (!existsSync(SOURCE)) {
      ctx.skip();
      return;
    }

    const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as unknown;

    if (JSON.stringify(source) !== JSON.stringify(cases)) {
      console.warn(
        '[WEB-10] Копия и источник различаются ВНЕ правила (status/title/description). ' +
          'Копия переносится целиком — обнови её отдельным коммитом.',
      );
    }

    expect(digestOf(ruleOf(source))).toBe(RULE_DIGEST);
    expect(ruleOf(source)).toEqual(ruleOf(cases));
  });

  it('версия 2 всё ещё новейшая — либо проверка объявлена НЕВЫПОЛНЕННОЙ', (ctx) => {
    if (!existsSync(SOURCE_DIR)) {
      ctx.skip();
      return;
    }

    const versions = readdirSync(SOURCE_DIR)
      .map((name) => /^visibility-cases\.v(\d+)\.json$/.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]));
    const newest = Math.max(...versions);

    expect(versions.length).toBeGreaterThan(0);
    expect(
      newest,
      `Источник выпустил visibility-cases.v${newest}.json, а мы согласованы с v${TABLE_VERSION}. ` +
        'Надо: 1) скопировать новый файл ЦЕЛИКОМ в apps/web/lib/contracts/ и удалить старый; ' +
        '2) поднять TABLE_VERSION и импорт; 3) пересчитать RULE_DIGEST по {defaults,reasons,items,trees}; ' +
        '4) прогнать мутации заново — новая версия обычно добавляет случаи ИМЕННО там, где прошлая ' +
        'проходила по неверной причине, и старый набор может их не покрыть.',
    ).toBe(TABLE_VERSION);
  });

  it('заменённая v1 говорит, что она заменена — либо проверка пропущена', (ctx) => {
    const v1 = path.join(SOURCE_DIR, 'visibility-cases.v1.json');
    if (!existsSync(v1)) {
      ctx.skip();
      return;
    }

    const old = JSON.parse(readFileSync(v1, 'utf8')) as { status?: string; supersededBy?: string };

    expect(old.supersededBy).toContain('visibility-cases');
    expect(old.status).toMatch(/заменен/i);
  });
});

describe('растяжки сверх таблицы', () => {
  it('скрытый узел уносит ВСЮ ветку, а не только себя', () => {
    const { items, hidden } = filterNavByJurisdiction(
      [
        {
          label: 'Британия',
          jurisdictions: ['uk-fca'],
          children: [
            {
              label: 'Глубже',
              jurisdictions: [],
              children: [{ label: 'Ещё глубже', jurisdictions: [], children: [] }],
            },
          ],
        },
      ],
      'eu-mifid',
    );

    expect(items).toEqual([]);
    expect(hidden).toBe(1);
  });

  it('исходное дерево не изменяется — фильтр возвращает новое', () => {
    const tree = [
      {
        label: 'Торговля',
        jurisdictions: [],
        children: [{ label: 'CFD', jurisdictions: ['uk-fca'], children: [] }],
      },
    ];
    const before = JSON.stringify(tree);

    filterNavByJurisdiction(tree, 'eu-mifid');

    expect(JSON.stringify(tree)).toBe(before);
  });

  it('readJurisdictions отбрасывает мусор, а не превращает его в запрет', () => {
    expect(
      readJurisdictions(['', null, 42, ' uk-fca ', { code: ' eu-mifid ' }, { code: 7 }]),
    ).toEqual(['uk-fca', 'eu-mifid']);
  });

  it('коды двух отказов различимы и не совпадают', () => {
    expect(visibilityIn(['uk-fca'], null).reason).toBe('jurisdiction-unknown');
    expect(visibilityIn(['uk-fca'], 'eu-mifid').reason).toBe('jurisdiction-not-listed');
    expect(visibilityIn([], null).reason).toBeNull();
  });
});
