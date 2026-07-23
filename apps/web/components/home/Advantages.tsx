import { useTranslations } from 'next-intl';
import { Container, Section } from '@broker/ui';

interface AdvantageItem {
  title: string;
  text: string;
}

export function Advantages() {
  const t = useTranslations('home.advantages');
  const items = t.raw('items') as AdvantageItem[];

  return (
    <Section className="border-t border-border bg-elevated/50">
      <Container>
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h2>
          <p className="mt-4 text-secondary sm:text-lg">{t('subtitle')}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:mt-14 lg:grid-cols-3 lg:gap-6">
          {items.map((item) => (
            <article
              key={item.title}
              className="group rounded-2xl border border-border bg-card p-6 transition-colors duration-300 hover:border-accent/40 lg:p-8"
            >
              <h3 className="text-lg font-semibold text-primary group-hover:text-accent">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-secondary">{item.text}</p>
            </article>
          ))}
        </div>
      </Container>
    </Section>
  );
}
