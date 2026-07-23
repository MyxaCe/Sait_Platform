import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Container } from '@broker/ui';

interface FooterColumn {
  title: string;
  links: { href: string; label: string }[];
}

export function SiteFooter() {
  const t = useTranslations('footer');
  const columns = t.raw('columns') as FooterColumn[];

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
          <p className="text-xs leading-relaxed text-secondary">{t('riskWarning')}</p>
          <p className="mt-4 text-xs text-secondary">
            {t('copyright', { year: new Date().getFullYear() })}
          </p>
        </div>
      </Container>
    </footer>
  );
}
