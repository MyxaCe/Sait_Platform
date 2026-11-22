export function tronscanTxUrl(hash: string): string | null {
  const h = hash.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(h) ? `https://tronscan.org/#/transaction/${h}` : null;
}

export function looksLikeTxHash(input: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(input.trim());
}

export function looksLikeTronAddress(input: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(input.trim());
}
