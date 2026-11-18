import { EXPECTED_MIGRATIONS } from './expected';

export interface SchemaState {
  applied: string[];
  missing: string[];
  ahead: string[];
}

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

export async function assertSchemaCurrent(db: SchemaQuerier): Promise<SchemaState> {
  const state = await readSchemaState(db);

  if (state.missing.length > 0) throw new SchemaBehindError(state.missing);

  return state;
}
