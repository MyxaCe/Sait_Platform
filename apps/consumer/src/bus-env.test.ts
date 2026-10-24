import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AmqpSubscriber, NullSubscriber, createSubscriber } from './subscriber.js';

/**
 * WEB-24 · пустая переменная шины даёт умолчание, а не пустое имя.
 *
 * **Почему этого мало — сторожа по тексту.** Сторож в `@broker/utils`
 * видит, что `??` в исходнике больше нет. Он не видит, что `envOr`
 * действительно зовут на пути создания подписчика: правило может быть
 * верным, а вызываться не оттуда. Этот разрыв у меня проскакивал
 * четырежды, и закрывается он только проверкой самого пути.
 *
 * **Почему пустое значение здесь опаснее отсутствующего.** Отсутствие
 * умолчание ловит. А пустое мимо `??` проходило насквозь, и каждое из
 * трёх имён меняло смысл по-своему, ни разу не дав ошибки:
 *
 *  - пустой обменник — это обменник AMQP по умолчанию, вполне рабочий;
 *  - пустое имя очереди просит брокер придумать случайное, и события
 *    уезжают в очередь, которую никто не читает и которой не станет
 *    при разрыве;
 *  - пустой ключ привязки под topic-обменником не совпадает ни с одним
 *    `terminal.*`.
 *
 * Во всех трёх случаях подписка поднимается и молчит как исправная.
 */

/** Поля приватные по типам, но на пути создания проверять надо именно их. */
function wiring(s: AmqpSubscriber): { exchange: string; queue: string; bindingKey: string } {
  const f = s as unknown as { exchange: string; queue: string; bindingKey: string };
  // Именно три поля, а не объект целиком: там ещё адрес и обработчик
  // отказов, и сравнение со всем сразу читалось бы как проверка имён,
  // проваливаясь по постороннему полю.
  return { exchange: f.exchange, queue: f.queue, bindingKey: f.bindingKey };
}

const KEYS = ['BUS_URL', 'BUS_EXCHANGE', 'BUS_QUEUE', 'BUS_BINDING_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('WEB-24 · имена шины при пустом окружении', () => {
  it.each([
    ['пустые строки', ''],
    ['одни пробелы', '   '],
  ])('%s дают умолчания, а не пустые имена', (_name, blank) => {
    process.env.BUS_URL = 'amqp://localhost';
    process.env.BUS_EXCHANGE = blank;
    process.env.BUS_QUEUE = blank;
    process.env.BUS_BINDING_KEY = blank;

    const sub = createSubscriber();
    expect(sub).toBeInstanceOf(AmqpSubscriber);
    expect(wiring(sub as AmqpSubscriber)).toEqual({
      exchange: 'platform.events',
      queue: 'cabinet.terminal-projection',
      bindingKey: 'terminal.#',
    });
  });

  it('заданные значения проходят как есть — умолчание не перекрывает настройку', () => {
    process.env.BUS_URL = 'amqp://localhost';
    process.env.BUS_EXCHANGE = 'other.events';
    process.env.BUS_QUEUE = 'other.queue';
    process.env.BUS_BINDING_KEY = 'other.#';

    expect(wiring(createSubscriber() as AmqpSubscriber)).toEqual({
      exchange: 'other.events',
      queue: 'other.queue',
      bindingKey: 'other.#',
    });
  });

  it.each([
    ['пустой', ''],
    ['пробельный', '   '],
  ])('%s BUS_URL — это отсутствие шины, а не адрес', (_name, blank) => {
    // Пробельный случай нашёлся зеркальной проверкой в релее: строка из
    // пробелов истинна, и `!url` её пропускал — служба поднималась на
    // несуществующем адресе вместо честного простоя.
    process.env.BUS_URL = blank;
    expect(createSubscriber()).toBeInstanceOf(NullSubscriber);
  });
});
