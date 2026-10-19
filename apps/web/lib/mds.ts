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

/** Почему каталога нет. Разные причины — разные адресаты починки. */
export type MdsCatalogUnavailableReason =
  /** `MDS_HTTP_URL` не задан в окружении ОТВЕЧАЮЩЕГО процесса. */
  | 'not-configured'
  /** Адрес есть, MDS не ответил или ответил не-2xx / нечитаемым телом. */
  | 'unreachable'
  /** MDS ответил, но ни одного символа в ответе нет. */
  | 'empty';

export type MdsCatalog =
  | { state: 'available'; symbols: Set<string> }
  | { state: 'unavailable'; reason: MdsCatalogUnavailableReason };

type FetchOutcome =
  | { ok: true; items: MdsInstrumentItem[] }
  | { ok: false; reason: 'not-configured' | 'unreachable' };

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
    if (!res.ok) return { ok: false, reason: 'unreachable' };
    const data = (await res.json()) as { items?: MdsInstrumentItem[] };
    // `items` нет в ответе — это НЕ пустой каталог: мы не поняли ответ.
    if (!Array.isArray(data.items)) return { ok: false, reason: 'unreachable' };
    return { ok: true, items: data.items };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

export async function getMdsCatalog(): Promise<MdsCatalog> {
  const outcome = await fetchMdsInstruments();
  if (!outcome.ok) return { state: 'unavailable', reason: outcome.reason };
  const symbols = new Set(
    outcome.items.map((i) => i.symbol).filter((s): s is string => Boolean(s)),
  );
  // Пустой каталог — это ответ «сейчас не транслируется ничего», а не
  // разрешение показать что-нибудь своё.
  if (symbols.size === 0) return { state: 'unavailable', reason: 'empty' };
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
