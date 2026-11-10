import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cn } from '@broker/ui';
import type { CabinetHomeModule } from '@broker/api-client';
import type { VerificationStatus } from '@/lib/home';
import { linkButton } from '@/features/ui/link-button';

type OnboardingConfig = Extract<CabinetHomeModule, { type: 'onboarding' }>;

interface Step {
  key: string;
  title: string;
  text: string;
  done: boolean;
  action?: { href: string; label: string; primary?: boolean };
}

/**
 * Модуль «Онбординг»: шаги нового клиента (состав — из CMS).
 * Верификация — по решению оператора (`client_verification`, не по старой
 * заглушке документов); пополнение — реальный счёт USDT (работает, а не
 * «после подключения провайдера», аудит К6).
 */
export async function OnboardingModule({
  config,
  verification,
  realFunded,
}: {
  config: OnboardingConfig;
  verification: VerificationStatus;
  realFunded: boolean;
}) {
  const t = await getTranslations('home');
  const steps: Step[] = [];

  if (config.steps.verification) {
    const done = verification === 'approved';
    steps.push({
      key: 'verification',
      title: t('stepVerificationTitle'),
      text: done
        ? t('stepVerificationDone')
        : verification === 'pending'
          ? t('stepVerificationPending')
          : verification === 'rejected'
            ? t('stepVerificationRejected')
            : t('stepVerificationText'),
      done,
      // На проверке — действовать нечего, кнопку не показываем.
      action:
        done || verification === 'pending'
          ? undefined
          : { href: '/profile?tab=verification', label: t('stepVerificationCta'), primary: true },
    });
  }
  if (config.steps.deposit) {
    steps.push({
      key: 'deposit',
      title: t('stepDepositTitle'),
      text: realFunded ? t('stepDepositDone') : t('stepDepositText'),
      done: realFunded,
      action: realFunded ? undefined : { href: '/wallet', label: t('stepDepositCta') },
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
  const doneLabel = t('stepDone');
  const pendingLabel = t('stepVerificationPendingShort');

  // Равная высота (замечание владельца r2): на ≥ sm карточки в одной строке
  // сетки тянутся до самой высокой, текст занимает остаток, а низ — всегда
  // слот 44 px (кнопка или отметка «Выполнено»), поэтому кнопки стоят на
  // одной линии. На телефоне карточки идут столбиком: выполненный шаг там —
  // одна строка (место отдано счетам), высоту сравнивать не с чем.
  return (
    <section className="grid gap-2 sm:grid-cols-3 sm:gap-3">
      {steps.map((step, i) => (
        <div
          key={step.key}
          data-step={step.key}
          data-done={String(step.done)}
          className={cn(
            'flex flex-col rounded-2xl border',
            step.done
              ? 'border-positive/25 bg-positive/[0.04] px-4 py-3 sm:p-4'
              : 'border-border bg-elevated p-4',
          )}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                step.done ? 'bg-positive/15 text-positive' : 'border border-border-strong text-secondary',
              )}
            >
              {step.done ? (
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <h3 className="text-sm font-semibold">{step.title}</h3>
          </div>
          <p
            className={cn(
              'mt-2 flex-1 text-xs leading-relaxed text-secondary',
              step.done && 'hidden sm:block',
            )}
          >
            {step.text}
          </p>
          <div className={cn('mt-3 flex min-h-[44px] items-end', step.done && 'hidden sm:flex')}>
            {step.action ? (
              <Link
                href={step.action.href}
                className={linkButton(step.action.primary ? 'primary' : 'secondary', 'w-full')}
              >
                {step.action.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'inline-flex h-[44px] items-center gap-1.5 text-sm font-medium',
                  step.done ? 'text-positive' : 'text-warning',
                )}
              >
                {step.done ? doneLabel : pendingLabel}
              </span>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
