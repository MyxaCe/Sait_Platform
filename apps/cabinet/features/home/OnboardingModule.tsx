import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button, cn } from '@broker/ui';
import type { CabinetHomeModule } from '@broker/api-client';
import type { VerificationStatus } from '@/lib/home';

type OnboardingConfig = Extract<CabinetHomeModule, { type: 'onboarding' }>;

/** Модуль «Онбординг»: шаги нового пользователя (состав — из CMS). */
export async function OnboardingModule({
  config,
  verification,
}: {
  config: OnboardingConfig;
  verification: VerificationStatus;
}) {
  const t = await getTranslations('home');

  const steps: { key: string; title: string; text: string; done: boolean; action?: { href: string; label: string } }[] = [];

  if (config.steps.verification) {
    steps.push({
      key: 'verification',
      title: t('stepVerificationTitle'),
      text:
        verification === 'approved'
          ? t('stepVerificationDone')
          : verification === 'pending'
            ? t('stepVerificationPending')
            : t('stepVerificationText'),
      done: verification === 'approved',
      action:
        verification === 'approved'
          ? undefined
          : { href: '/documents', label: t('stepVerificationCta') },
    });
  }
  if (config.steps.deposit) {
    steps.push({
      key: 'deposit',
      title: t('stepDepositTitle'),
      text: t('stepDepositText'),
      done: true, // демо-счёт пополняется автоматически; фиат — после платёжки
    });
  }
  if (config.steps.firstTrade) {
    steps.push({
      key: 'firstTrade',
      title: t('stepTradeTitle'),
      text: t('stepTradeText'),
      done: false,
      action: { href: '/trade', label: t('stepTradeCta') },
    });
  }

  if (steps.length === 0) return null;

  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, i) => (
        <div
          key={step.key}
          className={cn(
            'flex flex-col rounded-2xl border p-4',
            step.done ? 'border-positive/30 bg-positive/5' : 'border-border bg-elevated',
          )}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                step.done ? 'bg-positive text-base' : 'border border-border text-secondary',
              )}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <h3 className="text-sm font-semibold">{step.title}</h3>
          </div>
          <p className="mt-2 flex-1 text-xs leading-relaxed text-secondary">{step.text}</p>
          {step.action && (
            <Link href={step.action.href} className="mt-3">
              <Button size="sm" variant={step.key === 'verification' ? 'primary' : 'secondary'} tabIndex={-1}>
                {step.action.label}
              </Button>
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
