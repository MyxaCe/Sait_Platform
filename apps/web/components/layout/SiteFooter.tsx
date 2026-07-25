import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Container } from '@broker/ui';

export interface SiteFooterProps {
  /** Колонки и risk warning приходят из CMS (тег cms:navigation) */
  columns: { title: string; links: { href: string; label: string }[] }[];
  riskWarning: string;
  brandName: string;
  /** Соцсети бренда из CMS (тег cms:brand) */
  socials?: { name: string; url: string }[];
}

/** Иконки известных сетей; неизвестная сеть рендерится текстовой ссылкой */
const SOCIAL_ICONS: Record<string, string> = {
  telegram:
    'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  youtube:
    'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  twitter:
    'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
};

function SocialLink({ name, url }: { name: string; url: string }) {
  const icon = SOCIAL_ICONS[name.toLowerCase()];
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={title}
      title={title}
      className="flex items-center gap-1.5 text-secondary transition-colors hover:text-primary"
    >
      {icon ? (
        <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
          <path d={icon} />
        </svg>
      ) : (
        <span className="text-sm">{title}</span>
      )}
    </a>
  );
}

export function SiteFooter({ columns, riskWarning, brandName, socials = [] }: SiteFooterProps) {
  const t = useTranslations('footer');

  return (
    <footer className="border-t border-border bg-elevated">
      <Container className="py-12 lg:py-16">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="mb-4 text-sm font-semibold text-primary">{col.title}</h3>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-secondary transition-colors hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <p className="text-xs leading-relaxed text-secondary">{riskWarning}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-secondary">
              {t('copyright', { year: new Date().getFullYear() })}
            </p>
            {socials.length > 0 && (
              <div className="flex items-center gap-4" aria-label={brandName}>
                {socials.map((s) => (
                  <SocialLink key={s.url} name={s.name} url={s.url} />
                ))}
              </div>
            )}
          </div>
        </div>
      </Container>
    </footer>
  );
}
