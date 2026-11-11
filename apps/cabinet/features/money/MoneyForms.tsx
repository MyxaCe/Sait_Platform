'use client';

import { useEffect, useId, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, Callout, cn, formatMoney } from '@broker/ui';
import {
  claimDepositAction,
  requestWithdrawalAction,
  type MoneyFormState,
} from '@/lib/money-actions';
import { parseAmount } from './amount';
import { REAL_ACCOUNT_CURRENCY } from '@broker/money/display-currency';
import { looksLikeTronAddress, looksLikeTxHash } from './tronscan';

/**
 * Формы ввода/вывода USDT. Исход действия виден человеку всегда (успех,
 * отказ политики человеческим текстом, ошибка суммы/адреса) — молчащая
 * кнопка на реальных деньгах недопустима (урок WEB-42).
 *
 * Проверки формата здесь — подсказка до отправки (хэш 64 hex, адрес «T…»,
 * сумма в пределах доступного). Окончательно всё проверяет сервер и
 * терминал: экшены и их логика не менялись.
 */

const inputCls =
  'h-12 w-full rounded-xl border bg-sunken px-3.5 text-[16px] text-primary outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-60';

function Submit({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="md" loading={pending} disabled={disabled} className="w-full sm:w-auto">
      {label}
    </Button>
  );
}

function Outcome({ state, okKey, op }: { state: MoneyFormState; okKey: string; op: 'deposit' | 'withdraw' }) {
  const t = useTranslations('money');
  if (state.ok) {
    return <Callout tone="positive">{t(state.pending ? 'withdrawPending' : okKey)}</Callout>;
  }
  if (!state.error) return null;
  if (state.error === 'policy' && state.reasons?.length) {
    return (
      <Callout tone="negative" title={t(op === 'deposit' ? 'depositUnavailableTitle' : 'withdrawUnavailableTitle')}>
        {state.reasons.map((r) => (
          <p key={r}>{t.has(`policyText.${op}.${r}`) ? t(`policyText.${op}.${r}`) : t('errors.generic')}</p>
        ))}
      </Callout>
    );
  }
  if (state.error === 'kycLimitExceeded' && state.kycLimit) {
    return (
      <Callout tone="negative">
        {t('errors.kycLimitExceeded', {
          remaining: formatMoney(state.kycLimit.remainingMinor, REAL_ACCOUNT_CURRENCY),
          limit: formatMoney(state.kycLimit.limitMinor, REAL_ACCOUNT_CURRENCY),
        })}
      </Callout>
    );
  }
  return (
    <Callout tone="negative">{t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t('errors.generic')}</Callout>
  );
}

function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs text-negative">
      {children}
    </p>
  );
}

export function DepositClaimForm({ disabled }: { disabled: boolean }) {
  const t = useTranslations('money');
  const [state, action] = useFormState<MoneyFormState, FormData>(claimDepositAction, {});
  const [hash, setHash] = useState('');
  const [touched, setTouched] = useState(false);
  const ids = { hint: useId(), err: useId() };
  const valid = looksLikeTxHash(hash);
  const showError = touched && hash.trim() !== '' && !valid;

  // Принятый хэш — поле очищается: повторно его не отправят.
  useEffect(() => {
    if (state.ok) {
      setHash('');
      setTouched(false);
    }
  }, [state]);

  return (
    <form action={action} className="space-y-3" noValidate>
      <Outcome state={state} okKey="claimOk" op="deposit" />
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-secondary">{t('txHashLabel')}</span>
        <input
          name="txHash"
          required
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t('txHashPlaceholder')}
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showError || undefined}
          aria-describedby={`${ids.hint}${showError ? ` ${ids.err}` : ''}`}
          className={cn(inputCls, 'font-mono text-sm', showError ? 'border-negative' : 'border-border-strong')}
          disabled={disabled}
        />
      </label>
      <FieldError id={ids.err}>{showError ? t('txHashInvalid') : null}</FieldError>
      <p id={ids.hint} className="text-xs leading-relaxed text-muted">
        {t('txHashHint')}
      </p>
      <Submit label={t('submitClaim')} disabled={disabled || !valid} />
    </form>
  );
}

export function WithdrawForm({
  disabled,
  availableMinor,
  minMinor,
}: {
  disabled: boolean;
  /** Сколько можно вывести (свободная маржа терминала или баланс); null — неизвестно. */
  availableMinor: number | null;
  minMinor: number;
}) {
  const t = useTranslations('money');
  const [state, action] = useFormState<MoneyFormState, FormData>(requestWithdrawalAction, {});
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState({ address: false, amount: false });
  const [confirming, setConfirming] = useState(false);
  const ids = { addrHint: useId(), addrErr: useId(), amtHint: useId(), amtErr: useId() };

  const addrOk = looksLikeTronAddress(address);
  const parsed = parseAmount(amount);
  const cents = parsed.ok ? parsed.cents : null;
  const amountError = !parsed.ok
    ? parsed.reason === 'empty'
      ? null
      : t(`errors.amount_${parsed.reason}`)
    : parsed.cents < minMinor
      ? t('amountBelowMin', { min: formatMoney(minMinor, REAL_ACCOUNT_CURRENCY) })
      : availableMinor !== null && parsed.cents > availableMinor
        ? t('amountAboveAvailable', { available: formatMoney(availableMinor, REAL_ACCOUNT_CURRENCY) })
        : null;
  const ready = addrOk && cents !== null && amountError === null;
  const showAddrErr = touched.address && address.trim() !== '' && !addrOk;
  const showAmtErr = touched.amount && amountError !== null;

  useEffect(() => {
    if (state.ok) {
      setAddress('');
      setAmount('');
      setTouched({ address: false, amount: false });
      setConfirming(false);
    } else if (state.error) {
      // Отказ сервера — назад к правке: человек видит причину над формой.
      setConfirming(false);
    }
  }, [state]);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Outcome state={state} okKey="withdrawOk" op="withdraw" />

      {!confirming ? (
        <>
          <div className="space-y-1.5">
            <label htmlFor="wd-address" className="text-xs font-medium text-secondary">
              {t('withdrawAddress')}
            </label>
            <input
              id="wd-address"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="T…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setTouched((s) => ({ ...s, address: true }))}
              aria-invalid={showAddrErr || undefined}
              aria-describedby={`${ids.addrHint}${showAddrErr ? ` ${ids.addrErr}` : ''}`}
              className={cn(inputCls, 'font-mono text-sm', showAddrErr ? 'border-negative' : 'border-border-strong')}
              disabled={disabled}
            />
            <FieldError id={ids.addrErr}>{showAddrErr ? t('addressInvalidFormat') : null}</FieldError>
            <p id={ids.addrHint} className="text-xs text-muted">
              {t('withdrawAddressHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="wd-amount" className="text-xs font-medium text-secondary">
              {t('withdrawAmount')}
            </label>
            <div className="relative">
              <input
                id="wd-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => setTouched((s) => ({ ...s, amount: true }))}
                aria-invalid={showAmtErr || undefined}
                aria-describedby={`${ids.amtHint}${showAmtErr ? ` ${ids.amtErr}` : ''}`}
                className={cn(inputCls, 'pr-20 tabular-nums', showAmtErr ? 'border-negative' : 'border-border-strong')}
                disabled={disabled}
              />
              {availableMinor !== null && availableMinor > 0 ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setAmount((availableMinor / 100).toFixed(2));
                    setTouched((s) => ({ ...s, amount: true }));
                  }}
                  className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
                >
                  {t('max')}
                </button>
              ) : null}
            </div>
            <FieldError id={ids.amtErr}>{showAmtErr ? amountError : null}</FieldError>
            <p id={ids.amtHint} className="text-xs text-muted">
              {t('minWithdraw', { min: formatMoney(minMinor, REAL_ACCOUNT_CURRENCY) })}
            </p>
          </div>

          <Button
            type="button"
            size="md"
            disabled={disabled || !ready}
            onClick={() => setConfirming(true)}
            className="w-full sm:w-auto"
          >
            {t('continue')}
          </Button>
        </>
      ) : (
        <div className="space-y-4 rounded-xl border border-border-strong bg-sunken p-4" data-step="confirm">
          <p className="text-sm font-semibold">{t('confirmTitle')}</p>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">{t('confirmAddress')}</dt>
              <dd className="mt-0.5 break-all font-mono text-[13px] leading-relaxed tracking-tight min-[400px]:text-[14px] sm:text-[15px]">{address.trim()}</dd>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <dt className="text-xs text-muted">{t('confirmAmount')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                  {cents !== null ? formatMoney(cents, REAL_ACCOUNT_CURRENCY) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('confirmNetwork')}</dt>
                <dd className="mt-0.5 text-[15px]">{t('networkValue')}</dd>
              </div>
            </div>
          </dl>
          <p className="text-xs leading-relaxed text-warning">{t('confirmNote')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Submit label={t('confirmSubmit')} disabled={disabled || !ready} />
            <Button
              type="button"
              size="md"
              variant="secondary"
              onClick={() => setConfirming(false)}
              className="w-full sm:w-auto"
            >
              {t('edit')}
            </Button>
          </div>
        </div>
      )}

      {/* Значения уходят в экшен из этих полей (в конце формы — не сдвигают отступы). */}
      <input type="hidden" name="address" value={address.trim()} />
      <input type="hidden" name="amount" value={amount.trim()} />
    </form>
  );
}
