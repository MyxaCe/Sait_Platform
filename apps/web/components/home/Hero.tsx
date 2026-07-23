import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge, Button, Container, StatCounter } from '@broker/ui';

export function Hero() {
  const t = useTranslations('home.hero');
  const tCommon = useTranslations('common');

  return (
    <section className="relative flex min-h-[calc(100svh-4rem)] items-center overflow-hidden">
      {/* Фоновое свечение — позже заменится видеофоном с оверлеем */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 70% 20%, rgb(31 58 109 / 0.35), transparent), radial-gradient(ellipse 60% 40% at 20% 80%, rgb(212 164 55 / 0.08), transparent)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />

      <Container className="relative py-20 lg:py-28">
        <div className="max-w-xl animate-fade-up lg:max-w-2xl">
          <Badge className="mb-5">{t('badge')}</Badge>

          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-primary sm:text-5xl lg:text-7xl">
            {t.rich('title', {
              accent: (chunks) => <span className="text-accent">{chunks}</span>,
            })}
          </h1>

          <p className="mt-5 text-base leading-relaxed text-secondary sm:text-lg lg:mt-6 lg:text-xl">
            {t('subtitle')}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
            <Link href="/register" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:px-10" tabIndex={-1}>
                {tCommon('openAccount')}
              </Button>
            </Link>
            <Link href="/register?demo=1" className="w-full sm:w-auto">
              <Button variant="secondary" size="lg" className="w-full" tabIndex={-1}>
                {tCommon('freeDemo')}
              </Button>
            </Link>
          </div>

          <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-border pt-8 sm:grid-cols-3">
            <StatCounter value={1_240_000} label={t('statsTraders')} />
            <StatCounter value={87} suffix={t('statsVolumeSuffix')} label={t('statsVolume')} />
            <StatCounter
              value={14}
              suffix={t('statsExecutionSuffix')}
              label={t('statsExecution')}
              className="col-span-2 sm:col-span-1"
            />
          </dl>
        </div>
      </Container>
    </section>
  );
}
