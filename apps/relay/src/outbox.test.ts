import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBroker } from './testing/fake-broker.js';

/**
 * REL-04 на уровне СВЯЗКИ: «издатель отказал → что лежит в строке outbox».
 *
 * Вопрос, который задаётся отказу, — не «виден ли он», а в каком из двух
 * мест он виден: в логе процесса или в состоянии строки. В логе он был
 * виден всегда, и именно поэтому дефект выглядел починенным. В строке он
 * не появлялся ни разу: слушатель ошибок канала навешивался после первого
 * топологического вызова, процесс умирал раньше `catch`, и строка
 * оставалась с `attempts = 0` и пустым `last_error` — повторы не
 * отрабатывали ни разу.
 *
 * **Почему проверка здесь, а не в `publisher.test.ts`.** Там издатель
 * отказывает правильно и с дефектом, и без него — отличается только
 * судьба процесса, а строки outbox тому файлу не видно вовсе. Класс
 * «процесс умер до записи» модульным тестом издателя не ловится в
 * принципе. Измерено: мутация «слушатели снова после `checkExchange`»
 * красит 1 тест издателя и 2 здесь, и это разные вопросы, а не один
 * дважды.
 *
 * **Что моделирует двойник БД.** После смерти процесса запросы перестают
 * доходить. Без этого тест проверял бы вселенную, в которой упавший
 * процесс ещё дописывает строки, — то есть доказывал бы не то.
 */

const connect = vi.fn();
vi.mock('amqplib', () => ({ default: { connect: (...a: unknown[]) => connect(...a) } }));

interface Row {
  id: string;
  event_id: string;
  routing_key: string;
  payload: unknown;
  attempts: number;
}

const ROW: Row = {
  id: 'row-1',
  event_id: '11111111-2222-3333-4444-555555555555',
  routing_key: 'lead.submitted',
  payload: {
    event_id: '11111111-2222-3333-4444-555555555555',
    event: 'lead.submitted',
    version: 1,
    occurred_at: '2026-09-03T10:00:00.000Z',
    source: 'site-web',
    data: {},
  },
  attempts: 0,
};

interface Executed {
  sql: string;
  params: unknown[];
}

/**
 * Двойник pg-клиента: отдаёт одну строку outbox на SELECT и записывает
 * всё, что с ней делали. Мёртвый процесс запросов не выполняет.
 */
function fakeClient(broker: FakeBroker, rows: Row[] = [ROW]) {
  const executed: Executed[] = [];
  const client = {
    async query<R = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: R[] }> {
      if (broker.died) {
        throw new Error('процесс мёртв — запрос не доедет до базы');
      }
      executed.push({ sql, params });
      if (sql.includes('FROM outbox')) return { rows: rows as unknown as R[] };
      return { rows: [] };
    },
  };
  return { client, executed };
}

/** Что записано в строку: `attempts` и текст ошибки, либо `null`. */
function attemptWrite(executed: Executed[]) {
  const update = executed.find((q) => q.sql.includes('SET attempts'));
  if (!update) return null;
  return { attempts: update.params[1], lastError: update.params[3] };
}

beforeEach(() => {
  vi.resetModules();
  connect.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(broker: FakeBroker, rows?: (typeof ROW)[]) {
  connect.mockImplementation(broker.connectFn);
  const { AmqpPublisher } = await import('./publisher.js');
  const { processBatch } = await import('./outbox.js');
  const { client, executed } = fakeClient(broker, rows);
  const publisher = new AmqpPublisher('amqp://test', 'platform.events');
  const outcome = await processBatch(client, publisher).then(
    (n) => ({ ok: true as const, n }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return { outcome, executed };
}

describe('outbox · отказ публикации виден в СОСТОЯНИИ строки, а не только в логе', () => {
  it('пропавший обменник → attempts = 1 и текст ошибки в строке', async () => {
    const broker = new FakeBroker([]); // владелец шины обменник не завёл

    const { outcome, executed } = await run(broker);

    expect(broker.died).toBeNull(); // процесс дожил до записи
    expect(outcome.ok).toBe(true);
    const written = attemptWrite(executed);
    expect(written).not.toBeNull();
    expect(written!.attempts).toBe(1);
    // Пустая строка ошибки — это «отказ записан и ничего не говорит»:
    // ровно тот исход, от которого уходим
    expect(String(written!.lastError)).toMatch(/NOT_FOUND/);
  });

  it('повтор назначен: next_attempt_at сдвинут на backoff первой попытки', async () => {
    const broker = new FakeBroker([]);

    const { executed } = await run(broker);

    const update = executed.find((q) => q.sql.includes('SET attempts'))!;
    // `attempts = 0` в строке означал бы «повторять немедленно и вечно»;
    // backoff существует только если попытка вообще записана
    expect(update.params[2]).toBe('5000');
  });

  it('транзакция закрыта COMMIT: записанная попытка не откатывается', async () => {
    const broker = new FakeBroker([]);

    const { executed } = await run(broker);

    expect(executed.map((q) => q.sql).filter((s) => s === 'BEGIN' || s === 'COMMIT')).toEqual([
      'BEGIN',
      'COMMIT',
    ]);
  });

  it('обменник на месте → строка помечена опубликованной, попытка не пишется', async () => {
    const broker = new FakeBroker(['platform.events']);

    const { executed } = await run(broker);

    expect(broker.published).toHaveLength(1);
    expect(executed.some((q) => q.sql.includes('SET published_at'))).toBe(true);
    expect(attemptWrite(executed)).toBeNull();
  });

  it('сломанный конверт тоже попадает в строку, а не только в лог', async () => {
    // Растяжка: запись попытки обязана работать для ЛЮБОГО отказа строки,
    // не только для отказа шины. Иначе следующий отказ снова окажется
    // виден в одном месте из двух.
    const broker = new FakeBroker(['platform.events']);
    const broken = { ...ROW, payload: { event: 'lead.submitted' } };

    const { executed } = await run(broker, [broken]);

    expect(attemptWrite(executed)!.attempts).toBe(1);
    expect(broker.published).toHaveLength(0);
  });
});
