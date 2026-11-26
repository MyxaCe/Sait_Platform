import { readEnv } from '@broker/utils';
import { localizedPath } from '@broker/utils/locales';
import type { LinkBuilder } from '@broker/support';
import { getSiteLanguages } from '../site-languages';

/**
 * Ссылки из auth-писем ведут на публичный адрес кабинета (`CABINET_PUBLIC_URL`, задаётся
 * окружением сервера при запуске — домен в образ не вшит). Нет адреса — нет ссылки:
 * вызывающий отказывает (fail-closed), а не шлёт письмо с битой ссылкой.
 */
export async function authLinkBuilder(): Promise<LinkBuilder | null> {
  const base = readEnv(process.env.CABINET_PUBLIC_URL) ?? readEnv(process.env.NEXT_PUBLIC_SITE_URL);
  if (!base) return null;
  const root = base.replace(/\/+$/, '');
  const site = await getSiteLanguages();
  return (path, token, locale) => {
    const target = (site.languages as readonly string[]).includes(locale) ? locale : site.defaultLanguage;
    return `${root}${localizedPath(path, target, site.defaultLanguage)}?token=${encodeURIComponent(token)}`;
  };
}
