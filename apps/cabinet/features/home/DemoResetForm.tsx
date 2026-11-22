'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import { resetDemoAccountAction, type DemoResetOutcome } from '@/lib/actions';

const INITIAL: DemoResetOutcome = { state: 'idle' };

function messageKey(outcome: DemoResetOutcome): string | null {
  switch (outcome.state) {
    case 'idle':
      return null;
    case 'accepted':
      return 'resetAccepted';
    case 'too-often':
      return 'resetTooOften';
    case 'no-session':
      return 'resetNoSession';
    case 'unavailable':
      return 'resetUnavailable';
    case 'refused':
      switch (outcome.reason) {
        case 'account_not_flat':
          return 'resetPositionsOpen';
        case 'not_a_demo_account':
          return 'resetNotDemo';
        default:
          return 'resetRefused';
      }
  }
}

function tone(outcome: DemoResetOutcome): string {
  return outcome.state === 'accepted' ? 'text-secondary' : 'text-negative';
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="ghost" loading={pending} className="w-full sm:w-auto">
      {label}
    </Button>
  );
}

export function DemoResetForm({
  label,
  texts,
  className = 'mt-3',
}: {
  label: string;
  className?: string;
  texts: Record<string, string>;
}) {
  const [outcome, action] = useFormState(resetDemoAccountAction, INITIAL);
  const key = messageKey(outcome);

  return (
    <form action={action} className={className}>
      <SubmitButton label={label} />
      {key && (
        <p className={`mt-1 text-xs ${tone(outcome)}`} role="status" aria-live="polite">
          {texts[key] ?? texts.resetRefused}
        </p>
      )}
    </form>
  );
}
