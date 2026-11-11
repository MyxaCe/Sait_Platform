import { appendJournalSeqWithinTx, inTransaction, rollback, type PoolLike, type Queryable } from '@broker/money';
import { isValidEd25519PublicKeyPem, keyFingerprint } from './envelope';

/**
 * Реестр платформ группы — НАСТРОЙКА ячейки (таблица `group_platforms`), не
 * хардкод. В каждой ячейке свой экземпляр реестра: своя строка (slug =
 * SITE_SLUG процесса) и соседи. Меняет admin в «Настройках платформы» с
 * основанием (журнал `platform.group_registry.upserted`, до/после). Ячейки при
 * развёртывании прописывают реестр скриптом `seed:group-registry` (JSON).
 */

export interface GroupPlatform {
  slug: string;
  name: string;
  legalEntity: string | null;
  regulator: string | null;
  cabinetUrl: string;
  apiUrl: string | null;
  publicKeyPem: string | null;
  euLicense: boolean;
  servedCountries: string[];
  forbiddenCountries: string[];
  maxRetailLeverage: number | null;
  bonusesAllowed: boolean;
  acceptsTransfers: boolean;
  updatedAt: string | null;
}

export type GroupPlatformInput = Omit<GroupPlatform, 'updatedAt'>;

const COLUMNS = `slug, name, legal_entity, regulator, cabinet_url, api_url, public_key_pem, eu_license,
  served_countries, forbidden_countries, max_retail_leverage, bonuses_allowed, accepts_transfers, updated_at`;

function toIso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

function rowToPlatform(r: Record<string, unknown>): GroupPlatform {
  return {
    slug: String(r.slug),
    name: String(r.name),
    legalEntity: (r.legal_entity as string | null) ?? null,
    regulator: (r.regulator as string | null) ?? null,
    cabinetUrl: String(r.cabinet_url),
    apiUrl: (r.api_url as string | null) ?? null,
    publicKeyPem: (r.public_key_pem as string | null) ?? null,
    euLicense: Boolean(r.eu_license),
    servedCountries: ((r.served_countries as string[] | null) ?? []).map(String),
    forbiddenCountries: ((r.forbidden_countries as string[] | null) ?? []).map(String),
    maxRetailLeverage: r.max_retail_leverage == null ? null : Number(r.max_retail_leverage),
    bonusesAllowed: Boolean(r.bonuses_allowed),
    acceptsTransfers: Boolean(r.accepts_transfers),
    updatedAt: toIso(r.updated_at),
  };
}

export async function listGroupPlatforms(db: Queryable): Promise<GroupPlatform[]> {
  const r = await db.query(`SELECT ${COLUMNS} FROM group_platforms ORDER BY name, slug`);
  return r.rows.map(rowToPlatform);
}

export async function getGroupPlatform(db: Queryable, slug: string): Promise<GroupPlatform | null> {
  const r = await db.query(`SELECT ${COLUMNS} FROM group_platforms WHERE slug = $1`, [slug]);
  return r.rows[0] ? rowToPlatform(r.rows[0]) : null;
}

const ISO2 = /^[A-Z]{2}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;
const URL_RE = /^https?:\/\/[^\s/]+(?::\d+)?(?:\/[^\s]*)?$/;

/** Страны из строки «DE, FR fr» → ['DE','FR'] (ISO-2, без дублей). Мусор — ошибка, не тишина. */
export function parseCountryList(raw: string): { ok: true; value: string[] } | { ok: false; bad: string[] } {
  const items = raw
    .split(/[\s,;]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  const bad = items.filter((x) => !ISO2.test(x));
  if (bad.length) return { ok: false, bad };
  return { ok: true, value: [...new Set(items)].sort() };
}

export type PlatformValidationError =
  | 'invalidSlug'
  | 'missingName'
  | 'invalidCabinetUrl'
  | 'invalidApiUrl'
  | 'invalidPublicKey'
  | 'invalidCountries'
  | 'invalidLeverage';

export function validatePlatformInput(p: GroupPlatformInput): PlatformValidationError[] {
  const errors: PlatformValidationError[] = [];
  if (!SLUG.test(p.slug)) errors.push('invalidSlug');
  if (!p.name.trim()) errors.push('missingName');
  if (!URL_RE.test(p.cabinetUrl)) errors.push('invalidCabinetUrl');
  if (p.apiUrl !== null && !URL_RE.test(p.apiUrl)) errors.push('invalidApiUrl');
  if (p.publicKeyPem !== null && !isValidEd25519PublicKeyPem(p.publicKeyPem)) errors.push('invalidPublicKey');
  if ([...p.servedCountries, ...p.forbiddenCountries].some((c) => !ISO2.test(c))) errors.push('invalidCountries');
  if (p.maxRetailLeverage !== null && (!Number.isInteger(p.maxRetailLeverage) || p.maxRetailLeverage < 1 || p.maxRetailLeverage > 3000)) {
    errors.push('invalidLeverage');
  }
  return errors;
}

/** Вид записи для журнала: ключ — отпечатком, не PEM целиком. */
function journalView(p: GroupPlatformInput | GroupPlatform | null) {
  if (!p) return null;
  return {
    name: p.name,
    legalEntity: p.legalEntity,
    regulator: p.regulator,
    cabinetUrl: p.cabinetUrl,
    apiUrl: p.apiUrl,
    publicKey: keyFingerprint(p.publicKeyPem),
    euLicense: p.euLicense,
    servedCountries: p.servedCountries,
    forbiddenCountries: p.forbiddenCountries,
    maxRetailLeverage: p.maxRetailLeverage,
    bonusesAllowed: p.bonusesAllowed,
    acceptsTransfers: p.acceptsTransfers,
  };
}

export type UpsertPlatformResult =
  | { ok: true; created: boolean; journalSeq: number }
  | { ok: false; reason: 'missingReason' | 'noChange' }
  | { ok: false; reason: 'invalid'; errors: PlatformValidationError[] };

/** Запись реестра внутри открытой транзакции (форма admin и скрипт ячейки). */
export async function upsertGroupPlatformWithinTx(
  tx: Queryable,
  input: { operatorId: string; basis: string; platform: GroupPlatformInput },
): Promise<UpsertPlatformResult> {
  const basis = input.basis.trim();
  if (!basis) return { ok: false, reason: 'missingReason' };
  const p = {
    ...input.platform,
    name: input.platform.name.trim(),
    legalEntity: input.platform.legalEntity?.trim() || null,
    regulator: input.platform.regulator?.trim() || null,
    cabinetUrl: input.platform.cabinetUrl.trim().replace(/\/+$/, ''),
    apiUrl: input.platform.apiUrl?.trim().replace(/\/+$/, '') || null,
    publicKeyPem: input.platform.publicKeyPem?.trim() || null,
  };
  const errors = validatePlatformInput(p);
  if (errors.length) return { ok: false, reason: 'invalid', errors };

  const cur = await tx.query(`SELECT ${COLUMNS} FROM group_platforms WHERE slug = $1 FOR UPDATE`, [p.slug]);
  const before = cur.rows[0] ? rowToPlatform(cur.rows[0]) : null;
  const beforeView = journalView(before);
  const afterView = journalView(p);
  if (before && JSON.stringify(beforeView) === JSON.stringify(afterView) && before.publicKeyPem === p.publicKeyPem) {
    return { ok: false, reason: 'noChange' };
  }
  await tx.query(
    `INSERT INTO group_platforms (slug, name, legal_entity, regulator, cabinet_url, api_url, public_key_pem, eu_license,
       served_countries, forbidden_countries, max_retail_leverage, bonuses_allowed, accepts_transfers, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, legal_entity = EXCLUDED.legal_entity, regulator = EXCLUDED.regulator,
       cabinet_url = EXCLUDED.cabinet_url, api_url = EXCLUDED.api_url, public_key_pem = EXCLUDED.public_key_pem,
       eu_license = EXCLUDED.eu_license, served_countries = EXCLUDED.served_countries,
       forbidden_countries = EXCLUDED.forbidden_countries, max_retail_leverage = EXCLUDED.max_retail_leverage,
       bonuses_allowed = EXCLUDED.bonuses_allowed, accepts_transfers = EXCLUDED.accepts_transfers,
       updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [
      p.slug,
      p.name,
      p.legalEntity,
      p.regulator,
      p.cabinetUrl,
      p.apiUrl,
      p.publicKeyPem,
      p.euLicense,
      p.servedCountries,
      p.forbiddenCountries,
      p.maxRetailLeverage,
      p.bonusesAllowed,
      p.acceptsTransfers,
      input.operatorId,
    ],
  );
  const seq = await appendJournalSeqWithinTx(
    {
      operatorId: input.operatorId,
      action: 'platform.group_registry.upserted',
      subjectKind: 'platform',
      subjectId: `group_platform:${p.slug}`,
      payload: { basis, slug: p.slug, created: before === null, before: beforeView, after: afterView },
    },
    tx,
  );
  await tx.query(`UPDATE group_platforms SET last_journal_seq = $2 WHERE slug = $1`, [p.slug, seq]);
  return { ok: true, created: before === null, journalSeq: seq };
}

export async function upsertGroupPlatform(
  pool: PoolLike,
  input: { operatorId: string; basis: string; platform: GroupPlatformInput },
): Promise<UpsertPlatformResult> {
  return inTransaction<UpsertPlatformResult>(pool, async (tx) => {
    const r = await upsertGroupPlatformWithinTx(tx, input);
    return r.ok ? r : rollback<UpsertPlatformResult>(r);
  });
}

/**
 * Разбор JSON-описания реестра (скрипт ячейки, `platform-new.sh`). Формат —
 * массив объектов с полями `GroupPlatformInput` (camelCase); страны — массивы
 * ISO-2. Строго: неизвестная форма — ошибка с номером записи.
 */
export function parseRegistryJson(text: string): { ok: true; value: GroupPlatformInput[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `не JSON: ${(e as Error).message}` };
  }
  const list = Array.isArray(raw) ? raw : (raw as { platforms?: unknown })?.platforms;
  if (!Array.isArray(list)) return { ok: false, error: 'ожидался массив платформ (или { platforms: [...] })' };
  const out: GroupPlatformInput[] = [];
  for (const [i, item] of list.entries()) {
    const o = item as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);
    const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map((x) => String(x).toUpperCase()) : []);
    if (!str('slug') || !str('name') || !str('cabinetUrl')) {
      return { ok: false, error: `запись ${i + 1}: обязательны slug, name, cabinetUrl` };
    }
    out.push({
      slug: str('slug')!,
      name: str('name')!,
      legalEntity: str('legalEntity'),
      regulator: str('regulator'),
      cabinetUrl: str('cabinetUrl')!,
      apiUrl: str('apiUrl'),
      publicKeyPem: str('publicKeyPem'),
      euLicense: o.euLicense === true,
      servedCountries: arr('servedCountries'),
      forbiddenCountries: arr('forbiddenCountries'),
      maxRetailLeverage: typeof o.maxRetailLeverage === 'number' ? o.maxRetailLeverage : null,
      bonusesAllowed: o.bonusesAllowed === true,
      acceptsTransfers: o.acceptsTransfers !== false,
    });
  }
  return { ok: true, value: out };
}
