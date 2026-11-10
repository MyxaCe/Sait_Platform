import { getCms } from './cms';

/**
 * Бренд витрины — только из CMS (`cms:brand`), в коде его нет
 * (решение владельца 10.11). Имя, логотип, favicon, цвет, соцсети — поля
 * карточки сайта. Чего нет в legacy CMS (юр. имя) — из окружения ячейки
 * как временный мост до CMS v2 (`seo-profiles.organization`).
 *
 * `hexToRgbChannels` переехал в `@broker/utils` (общий хром сайта и
 * кабинета, ADR-025) и ре-экспортируется отсюда.
 */

export { hexToRgbChannels } from '@broker/utils';

/** Имя бренда из CMS. Нет ни CMS, ни сохранённой версии — бросает (см. `getCms`). */
export async function brandName(locale: string): Promise<string> {
  const brand = await getCms('brand', { locale: locale === 'en' ? 'en' : 'ru' });
  return brand.name;
}

/** Юридическое имя для JSON-LD: в legacy CMS поля нет — мост из окружения. */
export function legalNameFromEnv(): string | null {
  const raw = process.env.SITE_LEGAL_NAME?.trim();
  return raw ? raw : null;
}

/** Откуда взят фирменный цвет. */
export type PrimaryColorSource = 'cms' | 'tokens';

export interface ResolvedPrimaryColor {
  /** `null` — цвет не инжектируется, действует `--accent` из токенов. */
  readonly color: string | null;
  readonly source: PrimaryColorSource;
}

/**
 * Какой фирменный цвет показать.
 *
 * Запасного цвета в коде больше нет (прежде `FALLBACK_PRIMARY_COLOR`,
 * WEB-14). Цвет бренда — данные CMS; когда CMS его не задала (`null` в
 * v2), действует дизайн по умолчанию — токен `--accent` из
 * `@broker/ui/tokens.css`. Токен — это дизайн, а не бренд-контент, и
 * переопределяется перекраской токенов, а не строкой в коде витрины.
 */
export function resolvePrimaryColor(fromCms: string | null | undefined): ResolvedPrimaryColor {
  return fromCms ? { color: fromCms, source: 'cms' } : { color: null, source: 'tokens' };
}
