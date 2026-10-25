import { describe, expect, it } from 'vitest';
import {
  assertSchemaCurrent,
  readSchemaState,
  SchemaBehindError,
  SchemaUnknownError,
  type SchemaQuerier,
} from './schema-check';
import { EXPECTED_MIGRATIONS } from './expected';

/**
 * WEB-31 · «схема неизвестна» перестаёт быть состоянием, в котором
 * можно работать.
 */

const all = [...EXPECTED_MIGRATIONS];

function db(rows: string[] | Error): SchemaQuerier {
  return {
    async query() {
      if (rows instanceof Error) throw rows;
      return { rows: rows.map((name) => ({ name })) };
    },
  };
}

describe('WEB-31 · три состояния схемы, а не два', () => {
  it('всё применено → проходит', async () => {
    const state = await assertSchemaCurrent(db(all));

    expect(state.missing).toEqual([]);
    expect(state.ahead).toEqual([]);
  });

  it('часть не применена → отказ с ИМЕНАМИ недостающих', async () => {
    const promise = assertSchemaCurrent(db(all.slice(0, -1)));

    await expect(promise).rejects.toThrow(SchemaBehindError);
    await expect(promise).rejects.toThrow(all[all.length - 1] as string);
  });

  it('таблицы учёта нет → НЕИЗВЕСТНО, а не «ничего не применено»', async () => {
    // Главное различение задачи: пустой ответ и несуществующая таблица
    // — разные состояния, и второе значит, что мы не знаем ничего.
    await expect(assertSchemaCurrent(db(new Error('relation does not exist')))).rejects.toThrow(
      SchemaUnknownError,
    );
  });

  it('пусто, но таблица ЕСТЬ → это «отстала», а не «неизвестно»', async () => {
    const promise = assertSchemaCurrent(db([]));

    await expect(promise).rejects.toThrow(SchemaBehindError);
    await expect(promise).rejects.not.toThrow(SchemaUnknownError);
  });

  it('применено больше, чем знает код → НЕ отказ, но названо', async () => {
    // Штатное состояние выкатки: новая миграция прошла, старые
    // экземпляры ещё живы. Отказ здесь ронял бы каждую выкатку.
    const state = await assertSchemaCurrent(db([...all, '0006_future']));

    expect(state.ahead).toEqual(['0006_future']);
    expect(state.missing).toEqual([]);
  });

  it('отстала И опережает одновременно — оба названы', async () => {
    const state = await readSchemaState(db([...all.slice(0, -1), '0006_future']));

    expect(state.missing).toEqual([all[all.length - 1]]);
    expect(state.ahead).toEqual(['0006_future']);
  });

  it('отказ неизвестности говорит, что это НЕ «не применяли»', async () => {
    try {
      await assertSchemaCurrent(db(new Error('permission denied')));
      expect.unreachable('ожидался отказ');
    } catch (e) {
      // Текст отказа — инструмент того, кто чинит в три часа ночи.
      expect((e as Error).message).toContain('НЕИЗВЕСТНО');
      expect((e as Error).message).toContain('не знаем');
    }
  });
});
