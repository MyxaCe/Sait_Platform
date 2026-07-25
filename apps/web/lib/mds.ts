/**
 * Каталог MDS (ADR-024): какие символы реально стримятся живыми ценами.
 * Используется сервером для фильтрации подписок тикера, когда сайт
 * подключён к MDS (NEXT_PUBLIC_WS_URL): показывать замершие мок-цены
 * рядом с живыми нельзя. MDS недоступен → null (фильтр не применяется,
 * деградация видна через ConnectionDot).
 */
export async function getMdsSymbols(): Promise<Set<string> | null> {
  const url = process.env.MDS_HTTP_URL;
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/instruments`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: { symbol?: string }[] };
    const symbols = new Set(
      (data.items ?? []).map((i) => i.symbol).filter((s): s is string => Boolean(s)),
    );
    return symbols.size > 0 ? symbols : null;
  } catch {
    return null;
  }
}
