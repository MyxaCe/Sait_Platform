'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button } from '@broker/ui';
import { joinContestAction, type JoinContestOutcome } from '@/lib/promo-actions';

const INITIAL: JoinContestOutcome = { state: 'idle' };

const KNOWN = new Set([
  'reset_refused',
  'reset_unavailable',
  'already_joined',
  'contest_finished',
  'platform_disabled',
  'country_blocked',
  'country_not_allowed',
  'not_active',
  'unavailable',
]);

/**
 * Подпись исхода вступления. Отказ терминала «есть открытые позиции»
 * (`account_not_flat`) — отдельный понятный текст: что сделать клиенту.
 */
export function joinMessageKey(o: JoinContestOutcome): string | null {
  switch (o.state) {
    case 'idle':
      return null;
    case 'ok':
      return 'joinOk';
    case 'too-often':
      return 'joinError.tooOften';
    case 'no-session':
      return 'joinError.noSession';
    case 'error':
      if (o.reason === 'reset_refused' && o.detail === 'account_not_flat') return 'joinError.account_not_flat';
      return `joinError.${KNOWN.has(o.reason) ? o.reason : 'other'}`;
  }
}

function Confirm({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="min-h-[44px] w-full rounded-xl sm:w-auto">
      {label}
    </Button>
  );
}

/**
 * «Участвовать» в конкурсе — в два шага: сначала предупреждение «демо-счёт
 * будет сброшен к стартовой сумме», затем подтверждение. Без второго шага
 * клиент теряет демо-позиции одним касанием.
 */
export function JoinContestForm({ promotionId, startBalance }: { promotionId: string; startBalance: string }) {
  const t = useTranslations('contest');
  const [armed, setArmed] = useState(false);
  const [outcome, action] = useFormState(joinContestAction, INITIAL);
  const key = joinMessageKey(outcome);

  if (outcome.state === 'ok') {
    return (
      <p role="status" className="rounded-xl bg-positive/[0.08] px-3.5 py-3 text-sm text-primary ring-1 ring-inset ring-positive/25">
        {t('joinOk')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {!armed ? (
        <Button type="button" onClick={() => setArmed(true)} className="min-h-[44px] w-full rounded-xl sm:w-auto">
          {t('join')}
        </Button>
      ) : (
        <form
          action={action}
          className="space-y-3 rounded-xl bg-warning/[0.08] p-3.5 ring-1 ring-inset ring-warning/30"
          data-testid="join-confirm"
        >
          <input type="hidden" name="promotionId" value={promotionId} />
          <p className="text-sm font-semibold text-primary">{t('joinTitle')}</p>
          <p className="text-sm text-secondary">{t('joinBody', { amount: startBalance })}</p>
          <p className="text-sm text-secondary">{t('joinFlat')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Confirm label={t('joinConfirm')} />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setArmed(false)}
              className="min-h-[44px] w-full rounded-xl sm:w-auto"
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
      {key ? (
        <p role="alert" className="text-sm text-negative">
          {t(key)}
        </p>
      ) : null}
    </div>
  );
}
