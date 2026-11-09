'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button } from '@broker/ui';
import {
  claimDepositAction,
  requestWithdrawalAction,
  type MoneyFormState,
} from '@/lib/money-actions';

/**
 * Формы ввода/вывода USDT. Исход действия виден человеку всегда (успех,
 * отказ политики с причинами, ошибка суммы/адреса) — молчащая кнопка на
 * реальных деньгах недопустима (урок WEB-42).
 */

const inputCls =
  'w-full rounded-xl border border-border bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent';

function Submit({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? '…' : label}
    </Button>
  );
}

function Outcome({ state, okKey }: { state: MoneyFormState; okKey: string }) {
  const t = useTranslations('money');
  if (state.ok) {
    return (
      <p role="status" className="rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm text-positive">
        {t(state.pending ? 'withdrawPending' : okKey)}
      </p>
    );
  }
  if (!state.error) return null;
  let text = t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t('errors.generic');
  if (state.error === 'policy' && state.reasons?.length) {
    text = t('unavailable', {
      reasons: state.reasons.map((r) => (t.has(`policy.${r}`) ? t(`policy.${r}`) : r)).join(', '),
    });
  }
  return (
    <p role="alert" className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
      {text}
    </p>
  );
}

export function DepositClaimForm({ disabled }: { disabled: boolean }) {
  const t = useTranslations('money');
  const [state, action] = useFormState<MoneyFormState, FormData>(claimDepositAction, {});
  return (
    <form action={action} className="space-y-3">
      <Outcome state={state} okKey="claimOk" />
      <label className="block space-y-1 text-sm">
        <span className="text-secondary">{t('txHashLabel')}</span>
        <input
          name="txHash"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder={t('txHashPlaceholder')}
          className={`${inputCls} font-mono`}
          disabled={disabled}
        />
      </label>
      <Submit label={t('submitClaim')} disabled={disabled} />
    </form>
  );
}

export function WithdrawForm({ disabled }: { disabled: boolean }) {
  const t = useTranslations('money');
  const [state, action] = useFormState<MoneyFormState, FormData>(requestWithdrawalAction, {});
  return (
    <form action={action} className="space-y-3">
      <Outcome state={state} okKey="withdrawOk" />
      <label className="block space-y-1 text-sm">
        <span className="text-secondary">{t('withdrawAddress')}</span>
        <input
          name="address"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="T…"
          className={`${inputCls} font-mono`}
          disabled={disabled}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-secondary">{t('withdrawAmount')}</span>
        <input name="amount" required inputMode="decimal" placeholder="25.00" className={inputCls} disabled={disabled} />
      </label>
      <p className="text-xs text-secondary">{t('withdrawNote')}</p>
      <Submit label={t('submitWithdraw')} disabled={disabled} />
    </form>
  );
}
