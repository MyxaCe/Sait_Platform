/**
 * АНТИФРОД — сигналы связанности (дизайн §3.8). Для демо все сигналы —
 * ПОДСКАЗКИ оператору в очереди начислений: автоматических отказов нет,
 * решает человек, решение журналируется. Исключение — самореферал при
 * регистрации (`attribution-db.ts`): там атрибуция не ставится.
 *
 * Сигналы считаются чистой функцией над «отпечатками» клиентов; SQL,
 * собирающий отпечатки, — в `reader.ts`.
 */

export type SignalKind =
  /** Общий кошелёк-отправитель депозита с другим клиентом. */
  | 'shared_deposit_wallet'
  /** Общий адрес вывода с другим клиентом. */
  | 'shared_withdraw_address'
  /** Общий IP (сессии / регистрация) с другим клиентом. */
  | 'shared_ip'
  /** Получатель и второй участник пары (реферер ↔ друг, IB ↔ клиент) связаны. */
  | 'self_referral'
  /** Страна из формы не совпадает со страной по IP регистрации. */
  | 'country_mismatch'
  /** Остатка бюджета акции не хватает на это начисление. */
  | 'budget_insufficient';

export interface LinkSignal {
  kind: SignalKind;
  /** С кем связь (другой клиент). */
  withUserId?: string;
  /** Общее значение (адрес, IP) — для показа оператору. */
  value?: string;
}

export interface Fingerprint {
  userId: string;
  email?: string | null;
  depositWallets: readonly string[];
  withdrawAddresses: readonly string[];
  ips: readonly string[];
  country?: string | null;
  registrationIpCountry?: string | null;
}

/** IP, по которым связь не строится: локальные/служебные (прокси, разработка). */
export function isMeaningfulIp(ip: string | null | undefined): ip is string {
  if (!ip) return false;
  const v = ip.trim().toLowerCase();
  if (v === '' || v === 'local' || v === 'unknown') return false;
  if (v === '::1' || v.startsWith('127.') || v === '0.0.0.0') return false;
  return true;
}

/** Email к сравнению «тот же человек»: регистр, +метка, точки у gmail. */
export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

function shared(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(a.map((x) => x.trim()).filter(Boolean));
  return [...new Set(b.map((x) => x.trim()).filter((x) => set.has(x)))];
}

/**
 * Сигналы для получателя `target` относительно всех `others` (клиенты,
 * найденные по общим значениям). `counterpartUserId` — второй участник пары:
 * связь с ним — `self_referral`.
 */
export function computeLinkSignals(
  target: Fingerprint,
  others: readonly Fingerprint[],
  opts: { counterpartUserId?: string | null } = {},
): LinkSignal[] {
  const out: LinkSignal[] = [];
  const counterpart = opts.counterpartUserId ?? null;
  const targetIps = target.ips.filter(isMeaningfulIp);

  for (const o of others) {
    if (o.userId === target.userId) continue;
    let linked = false;
    for (const w of shared(target.depositWallets, o.depositWallets)) {
      out.push({ kind: 'shared_deposit_wallet', withUserId: o.userId, value: w });
      linked = true;
    }
    for (const a of shared(target.withdrawAddresses, o.withdrawAddresses)) {
      out.push({ kind: 'shared_withdraw_address', withUserId: o.userId, value: a });
      linked = true;
    }
    for (const ip of shared(targetIps, o.ips.filter(isMeaningfulIp))) {
      out.push({ kind: 'shared_ip', withUserId: o.userId, value: ip });
      linked = true;
    }
    const sameEmail =
      !!target.email && !!o.email && normalizeEmail(target.email) === normalizeEmail(o.email);
    if (counterpart && o.userId === counterpart && (linked || sameEmail)) {
      out.push({ kind: 'self_referral', withUserId: o.userId, ...(sameEmail ? { value: 'email' } : {}) });
    }
  }

  if (
    target.country &&
    target.registrationIpCountry &&
    target.country.toUpperCase() !== target.registrationIpCountry.toUpperCase()
  ) {
    out.push({
      kind: 'country_mismatch',
      value: `${target.country.toUpperCase()}≠${target.registrationIpCountry.toUpperCase()}`,
    });
  }
  return out;
}

/** Есть ли сигналы, требующие внимания (все, кроме чисто бюджетного). */
export function hasLinkage(signals: readonly LinkSignal[]): boolean {
  return signals.some((s) => s.kind !== 'budget_insufficient');
}

export function parseSignals(raw: unknown): LinkSignal[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is LinkSignal => typeof s === 'object' && s !== null && typeof (s as LinkSignal).kind === 'string',
  );
}
