import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import cases from './contracts/visibility-cases.v2.json';
import { filterNavByJurisdiction, readJurisdictions, visibilityIn } from './visibility';

/**
 * WEB-10 / Р-058, Р-061: прогон эталонной таблицы видимости, версия 2.
 *
 * **Что здесь контракт.** Не код CMS, а таблица случаев
 * `visibility-cases.v2.json`. Общий модуль на всех потребителей
 * физически невозможен — терминал на Rust, — поэтому согласие
 * проверяется против общего артефакта, и каждая реализация прогоняет
 * его сама, включая CMS, которая таблицу написала.
 *
 * **Честная граница, и она обязана стоять рядом с прогоном.**
 * Прохождение таблицы доказывает **согласие с прочтением CMS**, а не
 * правильность прочтения. Таблицу писал автор правила; ошибись он — все
 * реализации ошибутся одинаково и согласованно.
 *
 * **Почему версия 2, и чему это учит.** Версия 1 прошла у всех трёх
 * реализаций с первого прогона — и дыры были не в реализациях, а в
 * самих случаях. Нашла их команда `terminal` мутационным прогоном:
 * случай на форму `{code}` был записан РАЗРЕШАЮЩИМ, а разрешающий ответ
 * совпадает с умолчанием «во всех», то есть ровно с ответом
 * реализации, которая форму не читает вовсе. Там же: «юрисдикция не
 * задана» и «юрисдикция чужая» давали одинаковое `visible: false`, а
 * случаи на дерево сверяли только метки верхнего уровня — реализация,
 * возвращающая потомков НЕФИЛЬТРОВАННЫМИ, проходила таблицу целиком.
 *
 * Отсюда три требования v2, и все три проверяются ниже: ограничивающий
 * случай на чтение формы, отдельный КОД отказа, сверка дерева целиком.
 *
 * **Доставка — копия плюс сверка (Р-058).** Ниже две РАЗНЫЕ проверки:
 * «копия не правлена у нас» идёт везде, включая CI; «копия не разошлась
 * с источником» возможна только там, где лежат оба репозитория, и где
 * источника нет — объявляет себя НЕВЫПОЛНЕННОЙ, а не пройденной.
 */

/**
 * Отпечаток ПРАВИЛА, а не всего файла и не байтов.
 *
 * **Не байты.** Репозиторий забирается на Windows, git переписывает
 * `LF` в `CRLF` при checkout — байтовый хеш краснел бы на ровном месте.
 *
 * **Не весь файл, и это измерено.** Первая версия считала отпечаток по
 * всему документу и покраснела, когда `cms` сменила `status` с
 * «предложено штабу» на «принято штабом». Ни один случай не изменился.
 * Краснеть на редактуре прозы нельзя: после двух-трёх ложных тревог
 * красный результат перестают открывать.
 *
 * Отпечаток берётся с того, что ЕСТЬ правило: `defaults` и `reasons`
 * (машинно-читаемая семантика), `items`, `trees`. Проза расходится —
 * печатается предупреждение, прогон не валится. **Копия при этом
 * переносится целиком**, файл в файл: подгонка копии по одному полю
 * превратила бы сверку в ритуал.
 */
const RULE_DIGEST = '1bb2c603c1c64ac59902a3f6ced063aab99a67b3cfaf1b8ad1781a9ded68e36c';

/** Версия таблицы, против которой мы согласованы. */
const TABLE_VERSION = 2;

/** Та часть документа, которая и есть правило. */
function ruleOf(table: unknown): unknown {
  const t = table as Record<string, unknown>;
  return { defaults: t.defaults, reasons: t.reasons, items: t.items, trees: t.trees };
}

/** Каноническая форма: ключи отсортированы, пробелы не значат ничего. */
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

/* ------------------------------------------------------------------ */
/* 1. Прогон таблицы: пункт                                             */
/* ------------------------------------------------------------------ */

describe('эталонные случаи видимости · пункт', () => {
  it.each(cases.items.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    const verdict = visibilityIn(item.restrictions, item.jurisdiction);

    expect(verdict.visible).toBe(item.visible);
    // v2 сверяет КОД отказа, а не только булево: «юрисдикция неизвестна»
    // и «юрисдикция не в списке» — разные отказы и разные починки.
    expect(verdict.reason).toBe(item.reason);
  });

  it('охват объявлен числом И по свойствам, которые случаи закрепляют', () => {
    // Пустая таблица прошла бы любую реализацию: `it.each([])` — зелёный
    // прогон нуля случаев, и выглядит он как пройденный.
    expect(cases.items.length).toBeGreaterThanOrEqual(19);
    expect(cases.trees.length).toBeGreaterThanOrEqual(6);

    // Одного числа мало: исчезни из таблицы все случаи на чтение формы,
    // число осталось бы прежним, а дыра версии 1 вернулась бы.
    const pins = new Set(cases.items.map((i) => i.pins));
    expect([...pins].sort()).toEqual(['comparison', 'default', 'normalization', 'reads-field']);
  });

  it('случаи на чтение формы — ОГРАНИЧИВАЮЩИЕ, иначе они ничего не проверяют', () => {
    // Правило самой таблицы, и оно же дыра версии 1: разрешающий ответ
    // при ограничении, записанном только в проверяемой форме, совпадает
    // с умолчанием «во всех» — то есть с ответом непрочитавшего.
    const readsField = cases.items.filter((i) => i.pins === 'reads-field');

    expect(readsField.length).toBeGreaterThan(0);
    expect(readsField.some((i) => i.visible === false)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Прогон таблицы: дерево ЦЕЛИКОМ, а не метки верхнего уровня        */
/* ------------------------------------------------------------------ */

interface CaseNode {
  readonly label: string;
  readonly jurisdictions: readonly unknown[];
  readonly children: readonly CaseNode[];
}

interface ShapeNode {
  readonly label: string;
  readonly children: readonly ShapeNode[];
}

/**
 * Проекция результата в форму `visibleTree`: только метка и потомки.
 *
 * Сверять надо дерево целиком. На метках верхнего уровня реализация,
 * которая правильно считает скрытое, но возвращает потомков
 * НЕФИЛЬТРОВАННЫМИ, проходила таблицу v1 полностью.
 */
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
      // Число скрытого — часть контракта, но само по себе оно не
      // доказывает, что из дерева что-то убрали.
      expect(result.hidden).toBe(example.hidden);
    },
  );
});

/* ------------------------------------------------------------------ */
/* 3. Сверка копии: три РАЗНЫЕ проверки                                 */
/* ------------------------------------------------------------------ */

describe('копия таблицы', () => {
  it('не правлена у нас — отпечаток правила сошёлся', () => {
    // Идёт везде, включая CI. Ловит ровно один риск: кто-то поправил
    // случай в нашей копии, чтобы прогон позеленел.
    expect(digestOf(ruleOf(cases))).toBe(RULE_DIGEST);
  });

  it('не разошлась с источником — либо сверка объявлена НЕВЫПОЛНЕННОЙ', (ctx) => {
    if (!existsSync(SOURCE)) {
      // ПРОПУСК, а не предупреждение. Предупреждение внутри зелёного
      // теста — это и есть «невыполненная проверка, выглядящая
      // пройденной»: в сводке прогона она считается пройденной, а
      // строку в выводе никто не читает. Пропуск считается отдельно и
      // виден числом.
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
    /**
     * Сверка закреплена за ИМЕНЕМ ФАЙЛА. Выпусти CMS версию выше
     * отдельным файлом — копия осталась бы зелёной и устаревшей молча.
     *
     * Проверка уже сработала один раз: покраснела на появлении
     * `visibility-cases.v2.json` и тем заставила переехать с v1, где
     * три случая проходили по неверной причине. Ради этого она и есть.
     */
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
    // Текст падения перечисляет, что делать: красный тест без инструкции
    // превращается в «опять что-то», и его начинают откладывать.
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
    /**
     * Приём команды `cms`, и он стоит повторения: непрогоняемый
     * контракт, забывший сказать, что он не действует, красит прогон
     * следующему, кто его найдёт. Файл v1 оставлен в источнике
     * намеренно — удаление стёрло бы и факт, что версия была, и дату
     * замены, — но он обязан нести пометку.
     */
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

/* ------------------------------------------------------------------ */
/* 4. Растяжки сверх таблицы                                            */
/* ------------------------------------------------------------------ */

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
    // Потомки НЕ считаются отдельно: ушёл один узел, вместе с веткой.
    expect(hidden).toBe(1);
  });

  it('исходное дерево не изменяется — фильтр возвращает новое', () => {
    // Операция, меняющая объект на месте, молча испортила бы кеш
    // навигации: второй вызов с другой юрисдикцией получил бы уже
    // обрезанное дерево и спрятал лишнее.
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
    // v2 закрепляет это таблицей, но растяжка остаётся: один код на два
    // отказа вернул бы дыру версии 1, где таблица смотрела только булево.
    expect(visibilityIn(['uk-fca'], null).reason).toBe('jurisdiction-unknown');
    expect(visibilityIn(['uk-fca'], 'eu-mifid').reason).toBe('jurisdiction-not-listed');
    expect(visibilityIn([], null).reason).toBeNull();
  });
});
