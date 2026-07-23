import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Container } from '@broker/ui';
import { EducationTabs } from '@/components/education/EducationTabs';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default function EducationLayout({ children, params }: LayoutProps) {
  setRequestLocale(params.locale);
  return <LayoutContent>{children}</LayoutContent>;
}

function LayoutContent({ children }: { children: React.ReactNode }) {
  const t = useTranslations('education');
  return (
    <div className="py-10 md:py-14">
      <Container>
        <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
          {t('title')}
        </h1>
        <p className="mt-3 max-w-2xl text-secondary sm:text-lg">{t('subtitle')}</p>
        <div className="mt-8">
          <EducationTabs />
        </div>
        <div className="mt-8">{children}</div>
      </Container>
    </div>
  );
}
