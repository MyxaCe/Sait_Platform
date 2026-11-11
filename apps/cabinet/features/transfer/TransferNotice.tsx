import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getClientTransfers, LIVE_STATUSES } from '@broker/transfer';
import type { Queryable } from '@broker/money';
import { getPool } from '@/lib/db';

/**
 * Кабинет платформы-ИСТОЧНИКА: у клиента есть живой перевод на другую
 * платформу группы (проведён менеджером по заявлению клиента в поддержку).
 * Только информация: статус и инструкция по деньгам (вывод здесь → депозит
 * там). Кнопки «запросить перевод» в кабинете НЕТ (решение владельца 10.11):
 * инициатива — только заявление клиента в поддержку.
 */
export async function TransferNotice({ userId, withWithdrawLink = true }: { userId: string; withWithdrawLink?: boolean }) {
  let live: Awaited<ReturnType<typeof getClientTransfers>>[number] | undefined;
  try {
    const list = await getClientTransfers(getPool() as unknown as Queryable, userId);
    live = list.find((t) => (LIVE_STATUSES as readonly string[]).includes(t.status));
  } catch {
    return null; // нет таблиц/базы — блока нет, страница работает
  }
  if (!live) return null;
  const t = await getTranslations('platformTransfer');
  const target = live.targetName ?? live.targetPlatform;
  const statusKey = `status.${live.status}` as const;
  return (
    <section aria-label={t('outgoingTitle', { target })} className="rounded-2xl border border-info/40 bg-info/[0.07] p-4 text-sm">
      <p className="font-semibold text-primary">{t('outgoingTitle', { target })}</p>
      <p className="mt-1 text-secondary">{t('outgoingBody', { number: live.number, target })}</p>
      <p className="mt-1 text-secondary">{t('outgoingFunds')}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>{t('outgoingStatus', { status: t.has(statusKey) ? t(statusKey) : live.status })}</span>
        {withWithdrawLink && live.status !== 'source_closed' ? (
          <Link href="/wallet?tab=withdraw" className="font-medium text-accent hover:underline">
            {t('outgoingToWithdraw')} →
          </Link>
        ) : null}
      </p>
    </section>
  );
}
