import { EXPECTED_MIGRATIONS } from './expected';

/**
 * Проверка схемы при старте приложения (WEB-31).
 *
 * **Что закрывается.** До механизма миграций «схема актуальна» и
 * «схема неизвестна» были неотличимы: файлы из `db/init` выполняются
 * только при создании базы, на живом сервере правка не применялась
 * сама, и узнать об этом было нечем. Ровно так `005` пролежал
 * неприменённым.
 *
 * **Почему проверка, а не применение.** Применять миграции при старте
 * приложения — значит разрешить ЭКЗЕМПЛЯРУ менять схему. После работы
 * над единственным владельцем денежной строки это шаг назад: два
 * экземпляра, поднявшиеся разом, правили бы схему наперегонки, и
 * владельца у неё снова не было бы. Миграции — отдельный шаг выкатки;
 * приложение только отказывается работать на схеме, которой не знает.
 *
 * **Три состояния, а не два.**
 *
 *  - *неизвестна* — таблицы учёта нет или её не прочитать. Это НЕ
 *    «ничего не применено»: пустой ответ и несуществующая таблица
 *    различаются, и второе значит, что мы не знаем ничего. Отказ.
 *  - *отстала* — учёт есть, часть миграций не применена. Отказ с
 *    именами недостающих.
 *  - *опережает* — применено больше, чем знает этот код. Это штатное
 *    состояние выкатки: новая миграция уже прошла, старые экземпляры
 *    ещё живы. **Не отказ**, но называется: отказывать здесь значило
 *    бы ронять каждую выкатку.
 */

export interface SchemaState {
  applied: string[];
  missing: string[];
  ahead: string[];
}

/** Таблицы учёта нет: мы не знаем о схеме ничего. */
export class SchemaUnknownError extends Error {
  constructor(readonly cause?: unknown) {
    super(
      'Состояние схемы НЕИЗВЕСТНО: таблица учёта миграций не читается. ' +
        'Это не «миграций не применяли» — это «мы не знаем, что применено». ' +
        'Работать на такой базе нельзя: выполните шаг миграций выкатки.',
    );
    this.name = 'SchemaUnknownError';
  }
}

/** Схема отстала от кода на названные миграции. */
export class SchemaBehindError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `Схема отстала: не применены ${missing.join(', ')}. ` +
        'Приложение не стартует, чтобы не писать в таблицы, которых ещё нет ' +
        'или которые ещё не того вида.',
    );
    this.name = 'SchemaBehindError';
  }
}

/** Минимум, который нужен от драйвера базы. */
export interface SchemaQuerier {
  query(sql: string, params?: unknown[]): Promise<{ rows: { name: string }[] }>;
}

const MIGRATIONS_TABLE = 'pgmigrations';

export async function readSchemaState(db: SchemaQuerier): Promise<SchemaState> {
  let rows: { name: string }[];
  try {
    const result = await db.query(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`);
    rows = result.rows;
  } catch (error) {
    // Любая неудача чтения — неизвестность, а не пустота. Таблицы нет,
    // прав нет, база не отвечает: все три означают «не знаем».
    throw new SchemaUnknownError(error);
  }

  const applied = rows.map((r) => r.name);
  const appliedSet = new Set(applied);
  const expectedSet = new Set<string>(EXPECTED_MIGRATIONS);

  return {
    applied,
    missing: EXPECTED_MIGRATIONS.filter((m) => !appliedSet.has(m)),
    ahead: applied.filter((a) => !expectedSet.has(a)),
  };
}

/**
 * Отказывает работать на схеме, которой не знает.
 *
 * Возвращает состояние — в том числе `ahead`, чтобы вызывающий мог
 * сказать о нём в лог, не падая.
 */
export async function assertSchemaCurrent(db: SchemaQuerier): Promise<SchemaState> {
  const state = await readSchemaState(db);

  if (state.missing.length > 0) throw new SchemaBehindError(state.missing);

  return state;
}
