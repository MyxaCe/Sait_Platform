import { Badge } from '@broker/ui';
import { STATE_LABELS, type VerificationState } from '@/lib/clients/verification-state';

/**
 * Бейдж состояния верификации — локальная обёртка над `@broker/ui` `Badge`
 * (packages/ui не трогаем, §5.3). Единый словарь состояние → вариант/подпись
 * (как `StatusBadge` из дизайна): `unverified`→neutral, `pending`→accent,
 * `verified`→positive, `rejected`→negative, `resubmit_requested`→accent.
 */

type Variant = 'accent' | 'neutral' | 'positive' | 'negative';

const STATE_VARIANT: Record<VerificationState, Variant> = {
  unverified: 'neutral',
  pending: 'accent',
  verified: 'positive',
  rejected: 'negative',
  resubmit_requested: 'accent',
};

export function VerificationBadge({ state }: { state: VerificationState }) {
  return (
    <Badge variant={STATE_VARIANT[state]} className="px-2 py-0.5 text-xs">
      {STATE_LABELS[state]}
    </Badge>
  );
}

export function BlockBadge({ blocked }: { blocked: boolean }) {
  if (!blocked) return null;
  return (
    <Badge variant="negative" className="px-2 py-0.5 text-xs uppercase">
      Заблокирован
    </Badge>
  );
}
