import { unstable_noStore as noStore } from 'next/cache';
import {
  accessNotice,
  EDITORIAL_REUSE_WINDOW_SECONDS,
  fetchTenantConfig,
  isAccessClosed,
  isSymbolAllowed,
  readTenantSlug,
  type TenantAccess,
} from '@broker/tenant';

export { accessNotice, isAccessClosed, isSymbolAllowed };
export type {
  AccessNoticeSpec,
  TenantAccess,
  TenantAccessUnavailableReason,
} from '@broker/tenant';

export async function getTenantAccess(): Promise<TenantAccess> {
  noStore();

  const slug = readTenantSlug(process.env.SITE_SLUG);
  const { access } = await fetchTenantConfig({
    baseUrl: process.env.CMS_API_URL,
    slug,
    apiKey: process.env.CMS_API_KEY || undefined,
    fetchInit: {
      next: {
        revalidate: EDITORIAL_REUSE_WINDOW_SECONDS,
        tags: ['cms:brand', `cms:brand:${slug}`],
      },
    } as RequestInit,
  });
  return access;
}
