import {
  EDITORIAL_REUSE_WINDOW_SECONDS,
  fetchTenantConfig,
  isSymbolAllowed,
  readTenantSlug,
  type TenantConfig,
  type TenantStartBalance,
} from '@broker/tenant';

export { isSymbolAllowed };
export type {
  TenantAccess,
  TenantAccessUnavailableReason,
  TenantConfig,
  TenantStartBalance,
  TenantStartBalanceUnavailableReason,
} from '@broker/tenant';

export async function getTenantConfig(): Promise<TenantConfig> {
  return fetchTenantConfig({
    baseUrl: process.env.CMS_API_URL,
    slug: readTenantSlug(process.env.SITE_SLUG),
    apiKey: process.env.CMS_API_KEY || undefined,
    fetchInit: { next: { revalidate: EDITORIAL_REUSE_WINDOW_SECONDS } } as RequestInit,
  });
}

export async function getTenantStartBalance(): Promise<TenantStartBalance> {
  return (await getTenantConfig()).startBalance;
}
