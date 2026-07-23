import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button, Container, Section } from '@broker/ui';

export function CtaBand() {
  const t = useTranslations('home.cta');
  const tCommon = useTranslations('common');

  return (
    <Section>
      <Container>
        <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-gradient-to-br from-royal/40 via-card to-card p-8 text-center sm:p-12 lg:p-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 60% 60% at 50% 0%, rgb(212 164 55 / 0.12), transparent)',
            }}
          />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              {t('title')}
            </h2>
            <p className="mt-4 text-secondary sm:text-lg">{t('subtitle')}</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
              <Link href="/register" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:px-10" tabIndex={-1}>
                  {tCommon('openAccount')}
                </Button>
              </Link>
              <Link href="/register?demo=1" className="w-full sm:w-auto">
                <Button variant="ghost" size="lg" className="w-full" tabIndex={-1}>
                  {tCommon('tryDemo')}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
