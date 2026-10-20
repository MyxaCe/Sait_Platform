import { parseQuotesState, type QuotesState } from '@broker/realtime';

/**
 * Каталог MDS (ADR-024): какие символы РЕАЛЬНО стримятся живыми ценами.
 *
 * **Почему здесь нет ни одного умолчания** (Р-050, WEB-08). Прежняя
 * `getMdsSymbols()` возвращала `Set | null`, и `null` склеивал три разных
 * причины: переменная не задана, MDS не ответил, список пуст. Вызывающий
 * читал `null` как «фильтра нет» и подставлял зашитый
 * `DEFAULT_TICKER_SYMBOLS` — то есть рядом с живыми ценами в строке
 * оказывались символы, про которые никто не подтверждал, что они вообще
 * транслируются. Умолчание — это утверждение о том, чего мы не знаем.
 *
 * Теперь состояние названо: «каталог получен» и «каталога нет, вот
 * почему» — разные значения, и второе невозможно случайно прочитать как
 * первое. Три причины разведены, потому что чинятся они по-разному:
 * `not-configured` — наша конфигурация, `unreachable` — сосед,
 * `empty` — сосед ответил, но вселенная пуста.
 */
interface MdsInstrumentItem {
  symbol?: string;
  icon?: string | null;
}

/**
 * Почему каталога нет. Разные причины — разные адресаты починки.
 *
 * **Пять, а не три** (Р-070). Первая версия складывала «не дозвонились»,
 * «ответил не-2xx» и «ответил непонятным телом» в одно `unreachable` —
 * а это три разные неполадки у трёх разных людей: сеть, сосед, контракт.
 * Схлопнутые, они отправляют чинить наугад, и именно против этого Р-070
 * требует различать «не ответил» и «ответил не тем».
 *
 * Имена взяты те же, что у `TenantAccessUnavailableReason` в
 * `@broker/tenant`: один словарь причин на платформу дешевле двух
 * похожих.
 */
export type MdsCatalogUnavailableReason =
  /** `MDS_HTTP_URL` не задан в окружении ОТВЕЧАЮЩЕГО процесса. */
  | 'not-configured'
  /** Не дозвонились вовсе: соединение отклонено, таймаут, обрыв. */
  | 'network'
  /** Ответил, но не-2xx: сосед жив, каталог не отдал. */
  | 'http-error'
  /** Ответил 2xx, но тела мы не поняли — поля `items` нет либо оно не
   *  массив. Это НЕ пустой каталог: источник ничего не сказал. */
  | 'malformed'
  /** Ответил и честно сказал: сейчас не транслируется ничего. */
  | 'empty';

export type MdsCatalog =
  | { state: 'available'; symbols: Set<string> }
  | { state: 'unavailable'; reason: MdsCatalogUnavailableReason };

type FetchOutcome =
  | { ok: true; items: MdsInstrumentItem[] }
  | { ok: false; reason: Exclude<MdsCatalogUnavailableReason, 'empty'> };

async function fetchMdsInstruments(): Promise<FetchOutcome> {
  // Читается из окружения ТОГО процесса, который сейчас отвечает. На
  // сборке переменной нет — поэтому спрашивать каталог из статического
  // сегмента нельзя, и этого не делает никто: вопрос задаёт
  // `GET /api/quotes/catalog`, объявленная `force-dynamic`.
  const url = process.env.MDS_HTTP_URL;
  if (!url) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/instruments`, {
      // Каталог — не котировка: окно переиспользования здесь уместно и
      // к дефекту отношения не имеет. Чинился источник значения, а не
      // частота его обновления.
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2_000),
    });
    // Ответил, но не тем: сосед жив, каталог не отдал.
    if (!res.ok) return { ok: false, reason: 'http-error' };

    // Разбор тела — в СВОЁМ try. Иначе нечитаемый JSON улетал бы во
    // внешний `catch` и назывался бы `network`, то есть «не
    // дозвонились» — при том, что дозвонились и ответ получили.
    // Глушитель, поставленный ради ожидаемой сетевой ошибки, глотает и
    // ошибку формы ответа — ровно ту, ради которой проверка написана.
    let data: { items?: MdsInstrumentItem[] };
    try {
      data = (await res.json()) as { items?: MdsInstrumentItem[] };
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    // `items` нет в ответе — это НЕ пустой каталог: мы не поняли ответ.
    if (!Array.isArray(data.items)) return { ok: false, reason: 'malformed' };
    return { ok: true, items: data.items };
  } catch {
    // Досюда доходят только отказы транспорта: соединение отклонено,
    // таймаут, обрыв. Форма ответа разобрана выше и сюда не попадает.
    return { ok: false, reason: 'network' };
  }
}

/**
 * Состояние прошлого ответа — чтобы писать в лог НА СМЕНЕ СОСТОЯНИЯ, а
 * не на каждый запрос (Р-070).
 *
 * Строка на каждый тик перестаёт читаться так же быстро, как молчание:
 * при опросе раз в несколько секунд поток одинаковых сообщений
 * проматывают, и настоящая смена причины тонет среди повторов. Поэтому
 * повторы считаются и называются ЧИСЛОМ при восстановлении — «сколько
 * раз подряд» это диагностика, а не шум.
 *
 * Живёт в модуле, то есть у каждого экземпляра своё. Это правильно:
 * состояние описывает связь ЭТОГО процесса с MDS, а не факт о мире.
 */
let lastReason: MdsCatalogUnavailableReason | null | undefined;
let repeats = 0;

/** Сбрасывается тестами: модульное состояние иначе течёт между ними. */
export function __resetCatalogLogState(): void {
  lastReason = undefined;
  repeats = 0;
}

function reportCatalogState(reason: MdsCatalogUnavailableReason | null): void {
  if (reason === lastReason) {
    repeats += 1;
    return;
  }

  if (reason === null) {
    // Восстановление. Число повторов называем здесь — иначе «сколько
    // это длилось» останется неизвестным.
    console.info(
      `[mds] каталог снова доступен (предыдущее состояние: ${lastReason ?? 'неизвестно'}` +
        `${repeats > 0 ? `, повторов подряд: ${repeats}` : ''})`,
    );
  } else {
    console.error(
      `[mds] каталог недоступен: ${reason}. Строка котировок закрыта, ` +
        'выдуманные символы не подставляются (Р-050).',
    );
  }

  lastReason = reason;
  repeats = 0;
}

export async function getMdsCatalog(): Promise<MdsCatalog> {
  const outcome = await fetchMdsInstruments();
  if (!outcome.ok) {
    reportCatalogState(outcome.reason);
    return { state: 'unavailable', reason: outcome.reason };
  }

  const symbols = new Set(
    outcome.items.map((i) => i.symbol).filter((s): s is string => Boolean(s)),
  );
  // Пустой каталог — это ответ «сейчас не транслируется ничего», а не
  // разрешение показать что-нибудь своё.
  if (symbols.size === 0) {
    reportCatalogState('empty');
    return { state: 'unavailable', reason: 'empty' };
  }

  reportCatalogState(null);
  return { state: 'available', symbols };
}

/**
 * Иконки монет из MDS: символ → абсолютный URL для браузера.
 * Базовый URL — NEXT_PUBLIC_WS_URL (тот же origin MDS, что у socket.io).
 *
 * Умолчания здесь нет и быть не может: отсутствующая иконка — это
 * отсутствующая иконка, она ничего не утверждает о рынке и ни во что не
 * течёт. Поэтому пустая карта тут законна, в отличие от пустого каталога
 * символов выше. Названо вслух, чтобы следующий не «дозакрыл» это
 * состояние по аналогии.
 */
export async function getMdsIcons(): Promise<Record<string, string>> {
  const base = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '');
  if (!base) return {};
  const outcome = await fetchMdsInstruments();
  if (!outcome.ok) return {};
  const icons: Record<string, string> = {};
  for (const item of outcome.items) {
    if (item.symbol && item.icon) icons[item.symbol] = `${base}${item.icon}`;
  }
  return icons;
}

/**
 * Состояние котировок MDS: `unavailable[]` с причиной по символу и
 * `missing[]` (WEB-12, Р-074).
 *
 * **Две оси в одном ответе, и смешивать их нельзя.** Снаружи — ось канала
 * (`not-configured` · `network` · `http-error` · `malformed`): почему мы
 * вообще не получили ответа. Внутри — ось символа, её называет MDS по
 * каждому инструменту. Схлопнутые, они отправляют чинить наугад: «сеть
 * легла» и «у одного символа молчит источник» — разные неполадки у разных
 * людей.
 *
 * **Кеша здесь нет, в отличие от каталога.** Каталог меняется редко, и окно
 * в 300 с ему уместно; состояние котировок — это ровно то, что устаревает,
 * и замороженный ответ был бы тем самым дефектом, ради которого §5б
 * написан.
 */
export type MdsQuotesOutcome =
  | { state: 'available'; quotes: QuotesState }
  | { state: 'unavailable'; reason: Exclude<MdsCatalogUnavailableReason, 'empty'> };

export async function getMdsQuotesState(): Promise<MdsQuotesOutcome> {
  const url = process.env.MDS_HTTP_URL;
  if (!url) return { state: 'unavailable', reason: 'not-configured' };
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/quotes`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { state: 'unavailable', reason: 'http-error' };

    // Разбор тела — в своём `try`, по той же причине, что у каталога:
    // нечитаемый JSON иначе назвался бы `network`, то есть «не
    // дозвонились», хотя дозвонились и ответ получили.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { state: 'unavailable', reason: 'malformed' };
    }

    // Пустые списки — законный ответ: он означает «источник ничего не
    // сказал», а не «всё свежо» (§5г, требование 1). Поэтому `empty`
    // среди причин здесь нет: отсутствие состояния неотличимо от
    // состояния «нечего сообщить», и выдумывать разницу мы не вправе.
    return { state: 'available', quotes: parseQuotesState(body) };
  } catch {
    return { state: 'unavailable', reason: 'network' };
  }
}
