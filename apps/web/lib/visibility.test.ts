import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import cases from './contracts/visibility-cases.v1.json';
import { filterNavByJurisdiction, readJurisdictions, visibilityIn } from './visibility';

/**
 * WEB-10 / Р-058: прогон эталонной таблицы видимости по юрисдикции.
 *
 * **Что здесь контракт.** Не код CMS, а таблица случаев
 * `visibility-cases.v1.json`. Общий модуль на всех потребителей
 * физически невозможен — терминал на Rust, — поэтому согласие
 * проверяется против общего артефакта, и каждая реализация прогоняет
 * его сама, включая CMS, которая таблицу написала.
 *
 * **Честная граница, и она обязана стоять рядом с прогоном.**
 * Прохождение таблицы доказывает **согласие с прочтением CMS**, а не
 * правильность прочтения. Таблицу писал автор правила; если он понял
 * юрисдикции неверно, все реализации ошибутся одинаково и
 * согласованно. Против этого таблица не защищает и защищать не может —
 * это задача того, кто утверждает список юрисдикций. Зелёный цвет
 * здесь означает «мы читаем правило так же, как CMS», и ничего больше.
 *
 * **Доставка — копия плюс сверка (Р-058).** npm-пакет отвергнут: реестра
 * нет. Просто копия отвергнута тоже — это был бы седьмой производный
 * список, а шесть имеющихся уже названы главным источником ошибок.
 * Поэтому ниже две разные проверки, и путать их нельзя:
 *
 *   1. **Копия не правлена у нас** — сверка с отпечатком содержимого.
 *      Идёт везде, в том числе в CI, где репозитория CMS нет.
 *   2. **Копия не разошлась с источником** — сверка с файлом CMS.
 *      Возможна только там, где лежат оба репозитория. Где источника
 *      нет, проверка объявляет себя НЕВЫПОЛНЕННОЙ, а не пройденной:
 *      «материала не передали» и «расхождений нет» — разные
 *      утверждения, и второе здесь было бы подлогом.
 */

/**
 * Отпечаток СОДЕРЖИМОГО, а не байтов.
 *
 * Байтовый хеш сломался бы на первом же переводе строки: репозиторий
 * забирается на Windows, и git переписывает `LF` в `CRLF` при checkout.
 * Проверка, которая краснеет не по делу, перестаёт читаться — а после
 * двух-трёх ложных тревог её отключают.
 *
 * Значение снято с файла CMS 2026-10-19. Меняется вместе с таблицей:
 * новый случай — это изменение правила, а не правка фикстуры, и
 * обновление отпечатка обязано быть видно в дифсе.
 */
const CONTENT_DIGEST = '28b7eaa090453d961d3fe5beba5336912c3d0a0a6f049016db920559f1b796aa';

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

/**
 * Источник правила. Путь выведен из расположения репозиториев рядом;
 * отсутствие файла — законное состояние (CI), и обрабатывается явно.
 */
const SOURCE = path.resolve(
  __dirname,
  '../../../../cms/src/contracts/visibility-cases.v1.json',
);

/* ------------------------------------------------------------------ */
/* 1. Прогон таблицы                                                    */
/* ------------------------------------------------------------------ */

describe('эталонные случаи видимости · пункт', () => {
  it.each(cases.items.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    const verdict = visibilityIn(item.restrictions, item.jurisdiction);

    // Сверяется ровно то, что обещает таблица, — видимость. `reason`
    // обязан БЫТЬ, но его текст не контракт: это подпись для человека, и
    // закреплять её значило бы запретить перевод. `code` — наше поле,
    // таблица о нём не знает и знать не должна.
    expect(verdict.visible).toBe(item.visible);
    expect(verdict.reason).toEqual(item.visible ? null : expect.any(String));
  });
});

interface CaseNode {
  readonly label: string;
  readonly jurisdictions: readonly string[];
  readonly children: readonly CaseNode[];
}

describe('эталонные случаи видимости · дерево меню', () => {
  it.each(cases.trees.map((tree) => [tree.name, tree] as const))(
    'дерево: %s',
    (_name, example) => {
      const result = filterNavByJurisdiction(
        example.tree as readonly CaseNode[],
        example.jurisdiction,
      );

      expect(result.items.map((item) => item.label)).toEqual(example.visibleLabels);
      // Число скрытого — часть контракта, а не диагностика: без него
      // «меню пусто» неотличимо от «всё убрала юрисдикция».
      expect(result.hidden).toBe(example.hidden);
    },
  );
});

/* ------------------------------------------------------------------ */
/* 2. Охват: пустая таблица прошла бы любую реализацию                  */
/* ------------------------------------------------------------------ */

describe('охват таблицы объявлен числом', () => {
  it('случаев не меньше, чем в версии 1 контракта', () => {
    // Проверка, не объявляющая охват, перестаёт что-либо означать,
    // стоит кому-то случайно опустошить файл: `it.each([])` — зелёный
    // прогон нуля случаев, и он выглядит как пройденный.
    expect(cases.items.length).toBeGreaterThanOrEqual(14);
    expect(cases.trees.length).toBeGreaterThanOrEqual(3);
  });

  it('умолчания таблицы — те, под которые написано правило', () => {
    // Растяжка. Таблица несёт свои умолчания явным полем; если источник
    // когда-нибудь развернёт любое из них, случаи могут остаться
    // прежними по форме, а смысл правила поменяется.
    expect(cases.defaults).toEqual({
      emptyRestrictionsMeanEverywhere: true,
      unknownVisitorJurisdictionHides: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/* 3. Сверка копии: две РАЗНЫЕ проверки                                 */
/* ------------------------------------------------------------------ */

describe('копия таблицы', () => {
  it('не правлена у нас — отпечаток содержимого сошёлся', () => {
    // Идёт везде, включая CI. Ловит ровно один риск: кто-то поправил
    // случай в нашей копии, чтобы прогон позеленел.
    expect(digestOf(cases)).toBe(CONTENT_DIGEST);
  });

  it('не разошлась с источником — либо сверка объявлена НЕВЫПОЛНЕННОЙ', () => {
    if (!existsSync(SOURCE)) {
      // Источника рядом нет (CI). Объявляем это вслух и в выводе
      // прогона: невыполненная проверка обязана быть отличима от
      // пройденной. Молчаливый `return` здесь и был бы тем самым
      // «нарушений нет» вместо «нечего было проверять».
      console.warn(
        `[WEB-10] СВЕРКА С ИСТОЧНИКОМ НЕ ВЫПОЛНЕНА: ${SOURCE} недоступен. ` +
          'Проверен только отпечаток копии; расхождение с CMS отсюда не видно.',
      );
      expect(existsSync(SOURCE)).toBe(false);
      return;
    }

    const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as unknown;

    // По СОДЕРЖИМОМУ, а не по байтам: разный перевод строки и разные
    // отступы не являются расхождением правила.
    expect(digestOf(source)).toBe(CONTENT_DIGEST);
    expect(source).toEqual(cases);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Свойства, которых в таблице нет, но на них держится прочтение     */
/* ------------------------------------------------------------------ */

describe('версия таблицы', () => {
  it('v1 всё ещё новейшая — либо сверка объявлена НЕВЫПОЛНЕННОЙ', () => {
    /**
     * Сверка содержимого закреплена за ИМЕНЕМ ФАЙЛА `...v1.json`. Выпусти
     * CMS таблицу версией выше отдельным файлом — наша копия осталась бы
     * зелёной и устаревшей молча: тест, закреплённый за преходящим
     * фактом, перестаёт проверять, не покраснев.
     *
     * Поэтому отдельно сторожим появление соседней версии. Новый случай
     * в таблице — это изменение ПРАВИЛА, а не правка фикстуры, и узнать
     * о нём надо до выкатки, а не после.
     */
    const dir = path.dirname(SOURCE);
    if (!existsSync(dir)) {
      console.warn(
        `[WEB-10] ПРОВЕРКА ВЕРСИИ НЕ ВЫПОЛНЕНА: ${dir} недоступен. ` +
          'Появление visibility-cases.v2.json отсюда не видно.',
      );
      expect(existsSync(dir)).toBe(false);
      return;
    }

    const versions = readdirSync(dir)
      .map((name) => /^visibility-cases\.v(\d+)\.json$/.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]));

    expect(versions.length).toBeGreaterThan(0);
    expect(Math.max(...versions)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 3б. Барьер, который таблица НЕ различает                             */
/* ------------------------------------------------------------------ */

describe('БАРЬЕР «посетитель неизвестен» проверяется отдельно от таблицы', () => {
  /**
   * Измерено, а не предположено: мутация «снять ветку
   * `jurisdiction === null || jurisdiction === ''`» покрасила **ноль**
   * тестов — все 14 эталонных случаев остались зелёными.
   *
   * Причина в эшелонированной защите: ограничение `['uk-fca']` при
   * `jurisdiction: null` и так не проходит через `list.includes(null)`,
   * и отказ обеспечивает соседний слой. Видимый исход совпадает до
   * буквы — значит таблица, проверяющая только `visible`, этот барьер
   * не проверяет В ПРИНЦИПЕ.
   *
   * И это верно не только для нас: таблица одна на всех, поэтому тот же
   * барьер не покрыт и у CMS, и у терминала. Вынесено в отчёт штабу —
   * чинится оно добавлением случая в таблицу, а не у нас.
   *
   * Барьер проверяется по наблюдаемому различию — машинному коду
   * причины, которого у соседнего слоя быть не может.
   */
  it.each([
    ['юрисдикция не задана', null],
    ['юрисдикция пустой строкой', ''],
  ])('%s → скрыто ИМЕННО нашим барьером, а не промахом по списку', (_name, jurisdiction) => {
    const verdict = visibilityIn(['uk-fca'], jurisdiction);

    expect(verdict.visible).toBe(false);
    // Вот оно, различие: соседний слой дал бы `other-jurisdiction`.
    expect(verdict.code).toBe('visitor-unknown');
  });

  it('известная чужая юрисдикция — ДРУГОЙ барьер и другой диагноз', () => {
    // Растяжка к предыдущему: если оба случая начнут давать один код,
    // различие снова исчезнет, и барьер снова станет непроверяемым.
    expect(visibilityIn(['uk-fca'], 'eu-mifid').code).toBe('other-jurisdiction');
  });

  it('коды разных исходов не совпадают ни на одном из четырёх путей', () => {
    const codes = [
      visibilityIn([], 'eu-mifid').code,
      visibilityIn(['eu-mifid'], 'eu-mifid').code,
      visibilityIn(['uk-fca'], null).code,
      visibilityIn(['uk-fca'], 'eu-mifid').code,
    ];

    expect(new Set(codes).size).toBe(4);
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
            { label: 'Глубже', jurisdictions: [], children: [{ label: 'Ещё глубже', jurisdictions: [], children: [] }] },
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
      { label: 'Торговля', jurisdictions: [], children: [{ label: 'CFD', jurisdictions: ['uk-fca'], children: [] }] },
    ];
    const before = JSON.stringify(tree);

    filterNavByJurisdiction(tree, 'eu-mifid');

    expect(JSON.stringify(tree)).toBe(before);
  });

  it('две формы записи кода читаются одинаково на одном и том же дереве', () => {
    const asStrings = filterNavByJurisdiction(
      [{ label: 'X', jurisdictions: ['uk-fca'], children: [] }],
      'uk-fca',
    );
    const asGroups = filterNavByJurisdiction(
      [{ label: 'X', jurisdictions: [{ code: 'uk-fca' }], children: [] }],
      'uk-fca',
    );

    expect(asStrings.items.map((i) => i.label)).toEqual(asGroups.items.map((i) => i.label));
  });

  it('readJurisdictions отбрасывает мусор, а не превращает его в запрет', () => {
    expect(readJurisdictions(['', null, 42, ' uk-fca ', { code: ' eu-mifid ' }, { code: 7 }])).toEqual([
      'uk-fca',
      'eu-mifid',
    ]);
  });
});
