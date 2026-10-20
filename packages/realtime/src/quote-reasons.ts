/**
 * Ось символа: почему у ЭТОГО инструмента нет цены.
 *
 * Имена принадлежат MDS и живут в `_brain/КОНТРАКТЫ.md` §4г. Выписаны сюда
 * **руками из контракта**, а не из кода соседа: правило «новое имя
 * добавляется в §4г, а не в код» работает в обе стороны, и список,
 * списанный с чужой реализации, закрепил бы её ошибку вместо договора.
 *
 * **Три оси, и сводить их нельзя** — это разные вопросы:
 *  - ось символа (здесь) — почему нет цены у инструмента, называет MDS;
 *  - ось канала — почему мы вообще не получили ответа, называем мы сами
 *    (`not-configured` · `network` · `http-error` · `malformed` [· `empty`]);
 *  - коды служебной ручки MDS — про запрос MDS к себе.
 *
 * Совпадение `registry-unreadable` с осью канала... — его нет: в оси канала
 * такого имени не существует. Совпадение `registry-unreadable` **между осью
 * символа и кодами служебной ручки** — одно состояние под одним именем,
 * сознательно. Любое ДРУГОЕ совпадение имён между осями краснит тест.
 *
 * **Перечень существует в рантайме, тип выводится из него.** Перечисление,
 * живущее только в типе, компилятор стирает — ни стиль проверить, ни состав
 * сверить (§4г).
 */
export const SYMBOL_UNAVAILABLE_REASONS = [
  /** Реестр инструментов не читается — MDS не знает, что он ведёт. */
  'registry-unreadable',
  /** У символа не назначен источник цены. */
  'no-source',
  /** Источник назначен, но выключен. */
  'source-disabled',
  /** Источник подключён и молчит по этому символу. */
  'source-silent',
  /** Цена есть, но старше порога, названного источником. */
  'stale',
  /** Символа нет в каталоге MDS. */
  'not-in-catalog',
  /** Порог свежести не задан — судить о возрасте нечем (§5г, требование 1). */
  'threshold-unset',
] as const;

export type SymbolUnavailableReason = (typeof SYMBOL_UNAVAILABLE_REASONS)[number];

const KNOWN: ReadonlySet<string> = new Set(SYMBOL_UNAVAILABLE_REASONS);

export function isSymbolUnavailableReason(value: unknown): value is SymbolUnavailableReason {
  return typeof value === 'string' && KNOWN.has(value);
}

/**
 * Причина по одному символу.
 *
 * `reason: null` + `rawReason` — имя, которого в контракте нет. Такой случай
 * **не выбрасывается молча**: символ всё равно считается недоступным (это
 * сильная часть ответа, и терять её нельзя), но имя сохраняется как есть,
 * чтобы рассинхрон контракта был виден, а не выглядел как «всё хорошо».
 *
 * Это не мягкость ради мягкости. На 20.10 §4 контракта перечисляет те же
 * причины в `snake_case`, а §4г — в `kebab-case` и объявляет нормой второе,
 * потому что MDS переименовывает их сейчас. Если на провод придёт старое
 * написание, мы обязаны это ЗАМЕТИТЬ, а не принять за отсутствие причины.
 */
export interface SymbolUnavailable {
  symbol: string;
  reason: SymbolUnavailableReason | null;
  /** Исходная строка — заполняется, когда имя не из контракта. */
  rawReason?: string;
}

/** Состояние котировок, прочитанное из ответа `/v1/quotes`. */
export interface QuotesState {
  /** Символы без цены с машинной причиной по каждому. */
  unavailable: SymbolUnavailable[];
  /** Символы, о которых источник не сказал ничего. */
  missing: string[];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((i): i is Record<string, unknown> => isObject(i)) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Мягкий разбор ответа `/v1/quotes` (Р-074).
 *
 * «Мягко» означает «не падаем на лишних полях», а НЕ «молча превращаем
 * непонятное в хорошее»: §5б прямо предупреждает, что мягкий разбор здесь
 * работает против нас. Поэтому:
 *
 *  - элемент без строкового `symbol` отбрасывается — без символа причина
 *    ни к чему не относится;
 *  - элемент с незнакомой причиной СОХРАНЯЕТСЯ с `reason: null` и
 *    `rawReason`;
 *  - отсутствующие или не-массивы `unavailable`/`missing` читаются как
 *    пустые списки, и пустой список означает «источник ничего не сказал»,
 *    а не «всё свежо» (§5г, требование 1).
 */
export function parseQuotesState(body: unknown): QuotesState {
  const root = isObject(body) ? body : {};

  const unavailable: SymbolUnavailable[] = [];
  for (const item of asRecordArray(root.unavailable)) {
    const symbol = item.symbol;
    if (typeof symbol !== 'string' || symbol.length === 0) continue;

    const reason = item.reason;
    if (isSymbolUnavailableReason(reason)) {
      unavailable.push({ symbol, reason });
    } else {
      unavailable.push({
        symbol,
        reason: null,
        rawReason: typeof reason === 'string' ? reason : String(reason),
      });
    }
  }

  const missing = Array.isArray(root.missing)
    ? root.missing.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];

  return { unavailable, missing };
}

/**
 * Символы, которым нельзя верить, — для `quoteState` (§5г, ось 2).
 *
 * `missing` сюда входит наравне с `unavailable`: «источник не сказал о
 * символе ничего» — это тоже «цены нет», и показывать по нему последнюю
 * известную цену так же нельзя.
 */
export function staleSymbolsOf(state: QuotesState): ReadonlySet<string> {
  return new Set([...state.unavailable.map((u) => u.symbol), ...state.missing]);
}
