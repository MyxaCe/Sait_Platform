'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button } from '@broker/ui';
import { enrollPromotionAction, type EnrollOutcome } from '@/lib/promo-actions';

const INITIAL: EnrollOutcome = { state: 'idle' };

const KNOWN = new Set([
  'platform_disabled',
  'country_blocked',
  'country_not_allowed',
  'not_active',
  'not_started',
  'ended',
  'not_found',
  'not_enrollable',
  'already_enrolled',
  'unavailable',
]);

/** Ключ подписи исхода «Участвовать». Незнакомая причина — общий текст. */
export function enrollMessageKey(o: EnrollOutcome): string | null {
  switch (o.state) {
    case 'idle':
      return null;
    case 'ok':
      return 'enrollOk';
    case 'too-often':
      return 'enrollError.tooOften';
    case 'no-session':
      return 'enrollError.noSession';
    case 'error':
      return `enrollError.${KNOWN.has(o.reason) ? o.reason : 'unavailable'}`;
  }
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="min-h-[44px] w-full rounded-xl sm:w-auto">
      {label}
    </Button>
  );
}

export function EnrollForm({ promotionId }: { promotionId: string }) {
  const t = useTranslations('promo');
  const [outcome, action] = useFormState(enrollPromotionAction, INITIAL);
  const key = enrollMessageKey(outcome);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="promotionId" value={promotionId} />
      {outcome.state !== 'ok' ? <Submit label={t('enroll')} /> : null}
      {key ? (
        <p role="status" className={outcome.state === 'ok' ? 'text-sm text-positive' : 'text-sm text-negative'}>
          {t(key)}
        </p>
      ) : null}
    </form>
  );
}
