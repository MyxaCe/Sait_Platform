export class MissingTenantSlugError extends Error {
  readonly code = 'missing-tenant-slug';

  constructor(where: string) {
    super(
      `SITE_SLUG не задан (${where}). Приложение не знает, какой тенант обслуживает, ` +
        'и не имеет права работать от чужого имени: прежнее умолчание «apex-ru» ' +
        'подставляло чужой бренд, чужой allow-list и чужую юрисдикцию, а в выдаче ' +
        'токена — чужого тенанта. Задайте SITE_SLUG в окружении процесса (PKG-05).',
    );
    this.name = 'MissingTenantSlugError';
  }
}

export function readTenantSlug(raw: string | undefined | null): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function requireTenantSlug(raw: string | undefined | null, where: string): string {
  const slug = readTenantSlug(raw);
  if (slug === null) throw new MissingTenantSlugError(where);
  return slug;
}

export function assertTenantSlugAtStartup(where: string): string {
  return requireTenantSlug(process.env.SITE_SLUG, where);
}
