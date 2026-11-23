import { legalResponseSchema } from '@broker/api-client';
import { cmsGet } from './chrome';

/** Документы, с которыми клиент соглашается при регистрации, в порядке показа. */
export const CONSENT_SLUGS = ['terms', 'privacy', 'risk-disclosure'] as const;
export type ConsentSlug = (typeof CONSENT_SLUGS)[number];

export interface ConsentDocument {
  slug: ConsentSlug;
  title: string | null;
  /** Дата «Обновлено» документа в CMS — редакция, которую принимает клиент. */
  version: string | null;
}

export type ConsentSource = 'cms' | 'form' | 'unknown';

export interface ConsentRecord {
  slug: ConsentSlug;
  title: string | null;
  version: string;
  source: ConsentSource;
}

const VERSION_RE = /^[0-9A-Za-z:.+\-TZ ]{1,40}$/;

function isConsentSlug(value: unknown): value is ConsentSlug {
  return typeof value === 'string' && (CONSENT_SLUGS as readonly string[]).includes(value);
}

/** Документы из CMS; null — CMS не ответила или ответ не разобран. */
export function consentDocumentsFrom(data: unknown): ConsentDocument[] | null {
  const parsed = legalResponseSchema.safeParse(data);
  if (!parsed.success) return null;
  const bySlug = new Map(parsed.data.items.map((d) => [d.slug, d]));
  return CONSENT_SLUGS.map((slug) => {
    const doc = bySlug.get(slug);
    return { slug, title: doc?.title ?? null, version: doc?.updatedAt ?? null };
  });
}

export async function loadConsentDocuments(locale: string): Promise<ConsentDocument[] | null> {
  return consentDocumentsFrom(await cmsGet('legal', locale));
}

/** Редакции, показанные клиенту на странице (скрытое поле формы): `slug@version;…`. */
export function encodeShownVersions(docs: ConsentDocument[] | null): string {
  if (!docs) return '';
  return docs
    .filter((d) => d.version)
    .map((d) => `${d.slug}@${d.version}`)
    .join(';');
}

export function decodeShownVersions(raw: unknown): Map<ConsentSlug, string> {
  const out = new Map<ConsentSlug, string>();
  if (typeof raw !== 'string' || raw.length > 400) return out;
  for (const part of raw.split(';')) {
    const at = part.indexOf('@');
    if (at <= 0) continue;
    const slug = part.slice(0, at);
    const version = part.slice(at + 1);
    if (isConsentSlug(slug) && VERSION_RE.test(version)) out.set(slug, version);
  }
  return out;
}

/**
 * Что записать как принятое. Редакция с сервера важнее показанной: клиент не
 * может подменить её скрытым полем. Если CMS сейчас не ответила — пишем
 * показанную на странице (source 'form'), если и её нет — 'unknown'.
 */
export function consentRecords(
  server: ConsentDocument[] | null,
  shown: Map<ConsentSlug, string>,
): ConsentRecord[] {
  return CONSENT_SLUGS.map((slug) => {
    const fromServer = server?.find((d) => d.slug === slug);
    if (fromServer?.version) {
      return { slug, title: fromServer.title, version: fromServer.version, source: 'cms' as const };
    }
    const fromForm = shown.get(slug);
    if (fromForm) return { slug, title: fromServer?.title ?? null, version: fromForm, source: 'form' as const };
    return { slug, title: fromServer?.title ?? null, version: 'unknown', source: 'unknown' as const };
  });
}
