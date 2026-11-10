import { useLocale, useTranslations } from 'next-intl';
import { cabinetRegisterHref } from '@/lib/cabinet-links';
import { Badge, Button, Container } from '@broker/ui';

interface HeroFact {
  value: string;
  label: string;
}

export function Hero() {
  const t = useTranslations('home.hero');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const facts = t.raw('facts') as HeroFact[];

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
            <a href={cabinetRegisterHref('/register', locale)} className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:px-10" tabIndex={-1}>
                {tCommon('openAccount')}
              </Button>
            </a>
            <a href={cabinetRegisterHref('/register?demo=1', locale)} className="w-full sm:w-auto">
              <Button variant="secondary" size="lg" className="w-full" tabIndex={-1}>
                {tCommon('freeDemo')}
              </Button>
            </a>
          </div>

          {/*
            Здесь стояли счётчики «1 240 000 трейдеров · 87 млрд $ в месяц ·
            14 мс». Ни одна цифра не подтверждена: истории оборота и клиентской
            базы у площадки нет. Перед комплаенсом и инвесторами такая строка —
            не маркетинг, а заявление, которое нечем доказать. Вместо цифр —
            факты о продукте, каждый проверяется в нём самом.
          */}
          <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-border pt-8 sm:grid-cols-3">
            {facts.map((fact, i) => (
              <div
                key={fact.value}
                className={
                  i === facts.length - 1
                    ? 'col-span-2 flex flex-col gap-1 sm:col-span-1'
                    : 'flex flex-col gap-1'
                }
              >
                <dt className="order-2 text-sm text-secondary">{fact.label}</dt>
                <dd className="order-1 text-2xl font-semibold text-primary sm:text-3xl">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}
