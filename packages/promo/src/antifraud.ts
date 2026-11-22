export type SignalKind =
  | 'shared_deposit_wallet'
  | 'shared_withdraw_address'
  | 'shared_ip'
  | 'self_referral'
  | 'country_mismatch'
  | 'budget_insufficient';

export interface LinkSignal {
  kind: SignalKind;
  withUserId?: string;
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

export function isMeaningfulIp(ip: string | null | undefined): ip is string {
  if (!ip) return false;
  const v = ip.trim().toLowerCase();
  if (v === '' || v === 'local' || v === 'unknown') return false;
  if (v === '::1' || v.startsWith('127.') || v === '0.0.0.0') return false;
  return true;
}

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

export function hasLinkage(signals: readonly LinkSignal[]): boolean {
  return signals.some((s) => s.kind !== 'budget_insufficient');
}

export function parseSignals(raw: unknown): LinkSignal[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is LinkSignal => typeof s === 'object' && s !== null && typeof (s as LinkSignal).kind === 'string',
  );
}
