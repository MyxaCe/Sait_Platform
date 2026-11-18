import { useTranslations } from 'next-intl';
import { Container, Section } from '@broker/ui';
import { InstallPWAButton } from '@/features/pwa/InstallPWAButton';

export function DownloadApp({ brandName }: { brandName: string }) {
  const t = useTranslations('home.download');
  const features = t.raw('features') as string[];

  return (
    <Section className="border-t border-border">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
              {t('title')}
            </h2>
            <p className="mt-4 text-secondary sm:text-lg">{t('subtitle', { brand: brandName })}</p>
            <ul className="mt-8 space-y-3">
              {features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm text-secondary">
                  <svg
                    viewBox="0 0 24 24"
                    className="mt-0.5 size-4 shrink-0 fill-none stroke-accent"
                    aria-hidden
                  >
                    <path d="M5 13l4 4L19 7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
            <InstallPWAButton className="mt-8" />
          </div>

          <div className="mx-auto w-full max-w-[300px] lg:max-w-[340px]" aria-hidden>
            <div className="rounded-[2.5rem] border border-border bg-elevated p-3 shadow-2xl shadow-black/40">
              <div className="rounded-[2rem] bg-base p-4">
                <div className="mx-auto h-1.5 w-16 rounded-full bg-border" />
                <div className="mt-5 flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-accent text-xs font-bold text-base">
                    {brandName.charAt(0)}
                  </span>
                  <span className="text-sm font-semibold text-primary">{brandName}</span>
                </div>
                <div className="mt-4 space-y-2.5">
                  {['EURUSD', 'XAUUSD', 'BTCUSD', 'NAS100'].map((sym) => (
                    <div
                      key={sym}
                      className="flex items-center justify-between rounded-xl bg-card px-3.5 py-2.5"
                    >
                      <span className="text-xs font-medium text-primary">{sym}</span>
                      <span className="h-2 w-12 rounded-full bg-border" />
                      <span className="h-2 w-8 rounded-full bg-border" />
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid h-9 place-items-center rounded-xl bg-accent text-xs font-semibold text-base">
                  Торговать
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
