/**
 * Каталог MDS (ADR-024): какие символы реально стримятся живыми ценами.
 * Используется сервером для фильтрации подписок тикера, когда сайт
 * подключён к MDS (NEXT_PUBLIC_WS_URL): показывать замершие мок-цены
 * рядом с живыми нельзя. MDS недоступен → null (фильтр не применяется,
 * деградация видна через ConnectionDot).
 */
interface MdsInstrumentItem {
  symbol?: string;
  icon?: string | null;
}

async function fetchMdsInstruments(): Promise<MdsInstrumentItem[] | null> {
  const url = process.env.MDS_HTTP_URL;
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/instruments`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: MdsInstrumentItem[] };
    return data.items ?? null;
  } catch {
    return null;
  }
}

export async function getMdsSymbols(): Promise<Set<string> | null> {
  const items = await fetchMdsInstruments();
  if (!items) return null;
  const symbols = new Set(items.map((i) => i.symbol).filter((s): s is string => Boolean(s)));
  return symbols.size > 0 ? symbols : null;
}

/**
 * Иконки монет из MDS: символ → абсолютный URL для браузера.
 * Базовый URL — NEXT_PUBLIC_WS_URL (тот же origin MDS, что у socket.io).
 * MDS не подключён/недоступен → пустая карта (UI живёт без иконок).
 */
export async function getMdsIcons(): Promise<Record<string, string>> {
  const base = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '');
  if (!base) return {};
  const items = await fetchMdsInstruments();
  if (!items) return {};
  const icons: Record<string, string> = {};
  for (const item of items) {
    if (item.symbol && item.icon) icons[item.symbol] = `${base}${item.icon}`;
  }
  return icons;
}
