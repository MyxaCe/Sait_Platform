import { cn } from '../../lib/cn';

export interface AccountPlanFeature {
  label: string;
  value: string;
}

export interface AccountPlan {
  id: string;
  name: string;
  description?: string;
  /** Уже отформатированная строка: "$100" */
  minDeposit: string;
  featured?: boolean;
  features: AccountPlanFeature[];
  ctaLabel?: string;
  ctaHref?: string;
}

export interface PricingTableLabels {
  popular: string;
  popularChoice: string;
  terms: string;
  minDeposit: string;
  from: string;
  deposit: string;
  defaultCta: string;
}

const DEFAULT_LABELS: PricingTableLabels = {
  popular: 'Популярный',
  popularChoice: 'Популярный выбор',
  terms: 'Условия',
  minDeposit: 'Минимальный депозит',
  from: 'от',
  deposit: 'депозит',
  defaultCta: 'Открыть счёт',
};

export interface PricingTableProps {
  plans: AccountPlan[];
  /** Локализованные подписи; по умолчанию — русские */
  labels?: Partial<PricingTableLabels>;
  className?: string;
}

/**
 * Сравнение тарифов. Один источник данных — два представления:
 * mobile/tablet — snap-скролл карточек (таблицы на 360px нечитаемы),
 * desktop (lg+) — полная сравнительная таблица.
 * Серверный компонент: никакой интерактивности, CTA — обычные ссылки.
 */
export function PricingTable({ plans, labels: labelsProp, className }: PricingTableProps) {
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  return (
    <div className={className}>
      {/* Mobile/tablet: горизонтальный snap-скролл карточек */}
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 lg:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        {plans.map((plan) => (
          <article
            key={plan.id}
            className={cn(
              'relative w-[85vw] max-w-[340px] shrink-0 snap-center rounded-2xl border p-6',
              plan.featured ? 'border-accent bg-accent/5' : 'border-border bg-card',
            )}
          >
            {plan.featured && (
              <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-base">
                {labels.popular}
              </span>
            )}
            <h3 className="text-lg font-semibold text-primary">{plan.name}</h3>
            {plan.description && (
              <p className="mt-1 text-sm text-secondary">{plan.description}</p>
            )}
            <p className="mt-3 text-3xl font-bold text-primary">
              {labels.from} {plan.minDeposit}
              <span className="text-sm font-normal text-secondary"> {labels.deposit}</span>
            </p>
            <ul className="mt-5 space-y-3 text-sm">
              {plan.features.map((f) => (
                <li key={f.label} className="flex justify-between gap-4">
                  <span className="text-secondary">{f.label}</span>
                  <span className="text-right font-medium text-primary">{f.value}</span>
                </li>
              ))}
            </ul>
            {plan.ctaHref && (
              <a
                href={plan.ctaHref}
                className={cn(
                  'mt-6 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl font-medium transition-colors',
                  plan.featured
                    ? 'bg-accent text-base hover:bg-accent-hover'
                    : 'border border-border bg-card text-primary hover:bg-elevated',
                )}
              >
                {plan.ctaLabel ?? `${labels.defaultCta} ${plan.name}`}
              </a>
            )}
          </article>
        ))}
      </div>

      {/* Desktop: полная сравнительная таблица */}
      <div className="hidden overflow-hidden rounded-2xl border border-border lg:block">
        <table className="w-full text-sm">
          <thead className="bg-elevated">
            <tr>
              <th className="w-[26%] px-6 py-5 text-left font-medium text-secondary">
                {labels.terms}
              </th>
              {plans.map((plan) => (
                <th key={plan.id} className="px-6 py-5 text-center">
                  <span
                    className={cn(
                      'text-base font-semibold',
                      plan.featured ? 'text-accent' : 'text-primary',
                    )}
                  >
                    {plan.name}
                  </span>
                  {plan.featured && (
                    <span className="mt-1 block text-xs font-normal text-accent/80">
                      {labels.popularChoice}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr className="transition-colors hover:bg-elevated/50">
              <td className="px-6 py-4 text-secondary">{labels.minDeposit}</td>
              {plans.map((plan) => (
                <td
                  key={plan.id}
                  className="px-6 py-4 text-center font-semibold tabular-nums text-primary"
                >
                  {plan.minDeposit}
                </td>
              ))}
            </tr>
            {(plans[0]?.features ?? []).map((feature, row) => (
              <tr key={feature.label} className="transition-colors hover:bg-elevated/50">
                <td className="px-6 py-4 text-secondary">{feature.label}</td>
                {plans.map((plan) => (
                  <td key={plan.id} className="px-6 py-4 text-center tabular-nums text-primary">
                    {plan.features[row]?.value ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="px-6 py-5" />
              {plans.map((plan) => (
                <td key={plan.id} className="px-6 py-5 text-center">
                  {plan.ctaHref && (
                    <a
                      href={plan.ctaHref}
                      className={cn(
                        'inline-flex min-h-[44px] items-center justify-center rounded-xl px-6 text-sm font-medium transition-colors',
                        plan.featured
                          ? 'bg-accent text-base hover:bg-accent-hover'
                          : 'border border-border bg-card text-primary hover:bg-elevated',
                      )}
                    >
                      {plan.ctaLabel ?? labels.defaultCta}
                    </a>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
