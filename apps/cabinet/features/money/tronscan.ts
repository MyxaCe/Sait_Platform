/**
 * Ссылка на транзакцию в Tronscan (решение владельца 09.11: внешний домен
 * допустим только здесь, открывается в новой вкладке с
 * `rel="noopener noreferrer"`). Хэш нормализуется: без `0x`, нижний регистр;
 * не похожий на хэш — ссылки нет (не ведём клиента на мусорный адрес).
 */
export function tronscanTxUrl(hash: string): string | null {
  const h = hash.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(h) ? `https://tronscan.org/#/transaction/${h}` : null;
}

/** Формат хэша транзакции для подсказки на клиенте (сервер проверяет сам). */
export function looksLikeTxHash(input: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(input.trim());
}

/**
 * Формат адреса TRON для подсказки на клиенте: «T» + 33 символа base58.
 * Контрольную сумму (base58check) проверяет сервер — тут только явные опечатки.
 */
export function looksLikeTronAddress(input: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(input.trim());
}
