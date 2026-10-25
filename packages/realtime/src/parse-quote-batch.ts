import { INSTRUMENT_CATEGORIES, type InstrumentCategory, type Quote } from './types';

/**
 * Разбор батча котировок с провода (WEB-35).
 *
 * **Что было.** `socket.on('quotes:batch', (batch: Quote[]) => onBatch(batch))`
 * — тело **приводилось** к типу, а не разбиралось. Приведение к типу на
 * границе с соседом — тот же класс, что ноль вместо незнания, только
 * утверждается не значение, а **форма**: мы объявляем, что приехало, и
 * ни одна строка этого не проверяет.
 *
 * Три следствия, и третье хуже первых двух:
 *
 *  1. расхождение контракта не краснеет нигде;
 *  2. негодное значение уезжает в разметку как годное;
 *  3. **если сосед добавит поле, мы его не заметим** — оно молча
 *     потеряется, и «нам этого не дают» будет неотличимо от «нам это
 *     дают, а мы выбрасываем».
 *
 * Третье закрывается не разбором, а **отчётом**: незнакомое поле не
 * ошибка, но и не пустое место. Его имя называется вслух.
 *
 * **Граница строгости.** Разбор, падающий на всём незнакомом, уронит
 * котировки в первый же день, когда сосед что-нибудь добавит. Поэтому:
 * незнакомое поле — не ошибка, несовпавшая **форма известного** —
 * ошибка. Это та же мягкость, что у `parseQuotesState` для ручки:
 * «не падаем на лишних полях» и ни в коем случае не «молча превращаем
 * непонятное в хорошее».
 */

/** Поля, которые мы читаем. */
const MODELLED_FIELDS = [
  'symbol',
  'name',
  'category',
  'price',
  'digits',
  'changePercent',
  'bid',
  'ask',
  'ts',
] as const;

/**
 * Поля, про которые мы ЗНАЕМ, что сосед их шлёт, и сознательно не
 * читаем. Список существует затем, чтобы такое решение было записано в
 * коде, а не растворялось в молчаливом отбрасывании.
 *
 * `source` — происхождение тика (MDS Р-047, ADR-031). По их записи
 * смена значения на одном символе означает **смену источника цены, то
 * есть разрыв ряда, а не очередной тик**. Мы такое хотели бы
 * показывать разрывом, а сейчас теряем. Вынесено штабу; до решения поле
 * числится здесь, чтобы не считаться новостью каждую секунду.
 */
const ACKNOWLEDGED_FIELDS = ['source'] as const;

const KNOWN_FIELDS: ReadonlySet<string> = new Set<string>([
  ...MODELLED_FIELDS,
  ...ACKNOWLEDGED_FIELDS,
]);

/** Почему котировка отброшена. Поле названо — чинить есть что. */
export interface RejectedQuote {
  /** `null`, если негоден сам символ: тогда котировку не к чему отнести. */
  symbol: string | null;
  field: string;
  reason: 'missing' | 'wrong-type' | 'unknown-value';
}

export interface QuoteBatchParse {
  quotes: Quote[];
  rejected: RejectedQuote[];
  /**
   * Чего мы раньше не видели: `field:<имя>` — поле вне обоих списков;
   * `category:<значение>` — категория вне согласованного перечня.
   *
   * Это НЕ отказ. Это единственное место, где «сосед начал слать
   * что-то новое» перестаёт быть тишиной.
   */
  novelties: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Предикат, а не `Number.isInteger` на месте: тот возвращает `boolean`,
 * типа не сужает, и `digits` уезжал в котировку как `unknown`. Ровно
 * то, против чего написан весь этот файл, — только внутри него.
 */
/**
 * Годная цена: конечное число СТРОГО больше нуля.
 *
 * Ноль не «пусто», а утверждение: сделка по нулю. Отрицательная цена
 * покупки — то же самое с другой стороны. Оба случая читаются как
 * «этой цены нет», потому что сказать так нам есть чем.
 */
function isTradablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCategory(value: unknown): value is InstrumentCategory {
  return typeof value === 'string' && (INSTRUMENT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Разбирает одну котировку. `null` — не годна; причина уходит в
 * `rejected`.
 */
function parseQuote(
  raw: Record<string, unknown>,
  rejected: RejectedQuote[],
  novelties: string[],
): Quote | null {
  const symbol = raw.symbol;
  if (typeof symbol !== 'string' || symbol.length === 0) {
    rejected.push({
      symbol: null,
      field: 'symbol',
      reason: symbol === undefined ? 'missing' : 'wrong-type',
    });
    return null;
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_FIELDS.has(key)) novelties.push(`field:${key}`);
  }

  const fail = (field: string, reason: RejectedQuote['reason']): null => {
    rejected.push({ symbol, field, reason });
    return null;
  };

  const { name, category, price, digits, ts } = raw;

  if (typeof name !== 'string' || name.length === 0) {
    return fail('name', name === undefined ? 'missing' : 'wrong-type');
  }
  if (!isCategory(category)) {
    if (typeof category === 'string' && category.length > 0) {
      // Категория вне перечня — это новость, и её называют, даже
      // притом что котировка отброшена: иначе «сосед завёл облигации»
      // будет выглядеть как «облигации не приходят».
      novelties.push(`category:${category}`);
      return fail('category', 'unknown-value');
    }
    return fail('category', category === undefined ? 'missing' : 'wrong-type');
  }
  if (!isFiniteNumber(price)) return fail('price', price === undefined ? 'missing' : 'wrong-type');
  if (!isNonNegativeInteger(digits)) {
    return fail('digits', digits === undefined ? 'missing' : 'wrong-type');
  }
  // `ts` несёт гейт свежести: негодный момент означает, что протухшее от
  // свежего мы отличить не можем (WEB-17 показал, насколько это поле
  // нагружено). Ноль — законное значение: «настоящего чтения не было».
  if (!isFiniteNumber(ts) || ts < 0) return fail('ts', ts === undefined ? 'missing' : 'wrong-type');

  /*
    `changePercent` — единственное известное поле, негодная форма
    которого котировку НЕ отбрасывает, и это не послабление.

    У нас для него есть третье состояние: `null` — «цена известна,
    изменение неизвестно» (Р-118). Выбросить хорошую цену из-за
    нечитаемого процента значило бы потерять больше, чем мы не поняли.
    Терпимость здесь не ложь ровно потому, что незнание выразимо; там,
    где оно невыразимо, терпимости и нет.

    Отсутствие и `null` равны: у соседа поле не обнуляемое, он при
    незнании отбрасывает тик целиком — расхождение контракта вынесено
    штабу отдельно.
  */
  const rawChange = raw.changePercent;
  let changePercent: number | null = null;
  if (isFiniteNumber(rawChange)) {
    changePercent = rawChange;
  } else if (rawChange !== undefined && rawChange !== null) {
    rejected.push({ symbol, field: 'changePercent', reason: 'wrong-type' });
  }

  /*
    `bid` и `ask` разбираются по тому же правилу, что `changePercent`, и
    это не совпадение, а применение критерия: терпимость допустима
    тогда и только тогда, когда у получателя есть чем сказать
    «не знаю». У этих полей есть — они обнуляемые. Поэтому негодная
    форма даёт `null` и запись об отказе, а не выброшенную котировку:
    цена-то настоящая.

    Ноль и отрицательное — не форма, а значение, и отвергаются как
    значение: нулевая цена покупки означала бы сделку по нулю.
  */
  const bid = parseSideQuote(raw.bid, 'bid', symbol, rejected);
  const ask = parseSideQuote(raw.ask, 'ask', symbol, rejected);

  return { symbol, name, category, price, digits, changePercent, bid, ask, ts };
}

/**
 * Одна из двух сторон книги. Отсутствие и `null` равны: поставщик,
 * который их не даёт, не обязан слать пустые поля.
 */
function parseSideQuote(
  value: unknown,
  field: 'bid' | 'ask',
  symbol: string,
  rejected: RejectedQuote[],
): number | null {
  if (value === undefined || value === null) return null;
  if (isTradablePrice(value)) return value;
  rejected.push({
    symbol,
    field,
    reason: typeof value === 'number' ? 'unknown-value' : 'wrong-type',
  });
  return null;
}

export function parseQuoteBatch(raw: unknown): QuoteBatchParse {
  const rejected: RejectedQuote[] = [];
  const novelties: string[] = [];

  if (!Array.isArray(raw)) {
    // Не массив — это не «пустой батч». Пустой батч означал бы «сосед
    // сказал: обновлений нет», а здесь он не сказал ничего понятного.
    rejected.push({ symbol: null, field: '(batch)', reason: 'wrong-type' });
    return { quotes: [], rejected, novelties };
  }

  const quotes: Quote[] = [];
  for (const item of raw) {
    if (!isObject(item)) {
      rejected.push({ symbol: null, field: '(item)', reason: 'wrong-type' });
      continue;
    }
    const quote = parseQuote(item, rejected, novelties);
    if (quote) quotes.push(quote);
  }

  return { quotes, rejected, novelties: [...new Set(novelties)] };
}
