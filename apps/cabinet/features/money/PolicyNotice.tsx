import { getTranslations } from 'next-intl/server';
import { Callout } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import type { MoneyPolicyReason } from '@broker/money';

/**
 * Почему ввод/вывод недоступен — ЧЕЛОВЕЧЕСКИМ текстом и с действием
 * (аудит К6/К7): никаких машинных кодов на экране клиента. Код остаётся
 * только в `data-reasons` — для тестов и поддержки.
 *
 * Тон: «нужно пройти верификацию» — `info` (клиент может это исправить сам,
 * рядом кнопка), любые ограничения оператора — `negative`.
 */
export async function PolicyNotice({
  op,
  reasons,
  compact = false,
  className,
  banUntil = null,
}: {
  op: 'deposit' | 'withdraw';
  reasons: readonly MoneyPolicyReason[];
  /** Без заголовка — под кнопкой на главной. */
  compact?: boolean;
  className?: string;
  /** Срок «Запрета вывода» (заморозка после смены учётных данных) — «до …». */
  banUntil?: string | null;
}) {
  if (reasons.length === 0) return null;
  const t = await getTranslations('money');
  const onlyKyc = reasons.every((r) => r === 'kyc_required');
  const texts = reasons.map((r) =>
    r === 'withdraw_banned' && banUntil
      ? t('policyText.withdrawBannedUntil', { until: new Date(banUntil) })
      : t.has(`policyText.${op}.${r}`)
        ? t(`policyText.${op}.${r}`)
        : t('errors.generic'),
  );
  const action = reasons.includes('kyc_required') ? (
    <Link
      href="/profile?tab=verification"
      className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-accent px-3.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
    >
      {t('goVerify')}
    </Link>
  ) : null;

  return (
    <div data-reasons={reasons.join(',')} className={className}>
      <Callout
        tone={onlyKyc ? 'info' : 'negative'}
        title={compact ? undefined : t(op === 'deposit' ? 'depositUnavailableTitle' : 'withdrawUnavailableTitle')}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className={compact ? 'text-primary' : undefined}>
            {texts.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </Callout>
    </div>
  );
}
