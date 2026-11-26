export const DEFAULT_ADMIN_TITLE = 'Центр управления';

export interface AdminBrand {
  /** Название бренда из окружения; null — бренд не задан, показываем нейтральное. */
  name: string | null;
  /** Заголовок в шапке и на странице входа. */
  title: string;
  /** Буква в значке. */
  initial: string;
  /** Метка записи в приложении-аутентификаторе для новых подключений 2FA. */
  totpIssuer: string;
}

export function adminBrandFrom(raw: string | null | undefined): AdminBrand {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || null;
  const title = name ?? DEFAULT_ADMIN_TITLE;
  const initial = (title.match(/\p{L}|\p{N}/u)?.[0] ?? 'Ц').toUpperCase();
  return { name, title, initial, totpIssuer: name ? `${name} Admin` : DEFAULT_ADMIN_TITLE };
}
