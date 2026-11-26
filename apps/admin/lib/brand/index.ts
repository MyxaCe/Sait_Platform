import { unstable_noStore as noStore } from 'next/cache';
import { adminBrandFrom, type AdminBrand } from './brand';

export { DEFAULT_ADMIN_TITLE, adminBrandFrom, type AdminBrand } from './brand';

/**
 * Бренд админки читается из окружения в момент запроса (ADMIN_BRAND_NAME), а не при сборке:
 * один образ обслуживает любую платформу. noStore() не даёт Next заранее отрисовать
 * страницу входа с брендом, который был (не был) задан в момент сборки.
 */
export function adminBrand(): AdminBrand {
  noStore();
  return adminBrandFrom(process.env.ADMIN_BRAND_NAME);
}
