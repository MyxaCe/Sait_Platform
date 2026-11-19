'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@broker/ui';
import { useFeeText } from '@/features/promo/AccountsScreen';

export interface RegisterPlan {
  key: string;
  title: string;
  leverage: number;
  baseLeverage: number;
  classOverrides: Record<string, number>;
  markupBps: number;
  commissionBps: number;
  description: string | null;
  features: { label: string; value: string }[];
}

function PlanCard({ plan, checked, onSelect }: { plan: RegisterPlan; checked: boolean; onSelect: () => void }) {
  const t = useTranslations('accounts');
  const fee = useFeeText(plan.markupBps, plan.commissionBps);
  const classNames = (t.raw('classes') ?? {}) as Record<string, string>;
  const classes = Object.entries(plan.classOverrides);
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3.5 transition-colors',
        checked ? 'border-accent bg-accent/5 ring-1 ring-inset ring-accent/40' : 'border-border hover:border-accent/40',
      )}
      data-plan={plan.key}
    >
      <span className="flex items-center gap-2.5">
        <input
          type="radio"
          name="accountType"
          value={plan.key}
          checked={checked}
          onChange={onSelect}
          className="h-4 w-4 accent-accent"
        />
        <span className="font-semibold">{plan.title}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums">{t('leverageValue', { n: plan.leverage })}</span>
      </span>
      {classes.length > 0 ? (
        <span className="pl-6 text-xs text-muted">
          {[
            t('leverageBase', { n: plan.baseLeverage }),
            ...classes.map(([cls, n]) => t('classLeverage', { class: classNames[cls] ?? cls, n })),
          ].join(' · ')}
        </span>
      ) : null}
      <span className="pl-6 text-xs text-secondary">{fee}</span>
      {plan.description ? <span className="pl-6 text-sm text-secondary">{plan.description}</span> : null}
      {plan.features.length > 0 ? (
        <ul className="pl-6 text-xs text-secondary">
          {plan.features.map((f) => (
            <li key={`${f.label}:${f.value}`}>
              <span className="text-muted">{f.label}:</span> {f.value}
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}

export function PlanPicker({ plans, selected }: { plans: RegisterPlan[]; selected: string }) {
  const t = useTranslations('auth');
  const [value, setValue] = useState(selected);
  return (
    <fieldset className="flex flex-col gap-2" data-testid="plan-picker">
      <legend className="mb-1.5 text-sm font-medium">{t('accountType')}</legend>
      {plans.map((plan) => (
        <PlanCard key={plan.key} plan={plan} checked={value === plan.key} onSelect={() => setValue(plan.key)} />
      ))}
    </fieldset>
  );
}
