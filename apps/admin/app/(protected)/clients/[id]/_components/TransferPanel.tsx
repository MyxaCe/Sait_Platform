import Link from 'next/link';
import { Panel, ToneBadge } from '@broker/ui';
import { getClientTransfers, getInboundForUser } from '@broker/transfer';
import { getPool } from '@/lib/db';
import { fmtDateTime } from '@/lib/ui/format';
import { inboundStatus, transferStatus } from '@/lib/transfer/labels';

/**
 * Карточка клиента, вкладка «Обзор»: перевод на другую платформу группы
 * (ветка client-transfer). Исходящие переводы клиента и, если клиент пришёл
 * сюда по переводу, — откуда. Кнопка «Перевести…» — в шапке карточки,
 * только у закреплённого менеджера.
 */
export async function TransferPanel({ userId, canTransfer }: { userId: string; canTransfer: boolean }) {
  const db = getPool();
  const [outgoing, inbound] = await Promise.all([getClientTransfers(db, userId), getInboundForUser(db, userId)]);
  if (!outgoing.length && !inbound && !canTransfer) return null;
  return (
    <Panel title="Перевод между платформами группы" description="Только по заявлению клиента в поддержку">
      <div className="space-y-3 text-[13px]">
        {inbound ? (
          <p className="text-secondary">
            Пришёл по переводу <span className="font-mono">{inbound.number}</span> из {inbound.sourceName ?? inbound.sourcePlatform} ·{' '}
            <ToneBadge tone={inboundStatus(inbound.status).tone}>{inboundStatus(inbound.status).label}</ToneBadge>
            {inbound.refundTask === 'open' ? <span className="text-warning block">Задача: вернуть внесённые средства выводом.</span> : null}
          </p>
        ) : null}
        {outgoing.map((t) => {
          const s = transferStatus(t.status);
          return (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/clients/transfers/${t.id}`} className="text-accent font-mono hover:underline">
                {t.number}
              </Link>
              <span className="text-muted">→ {t.targetName ?? t.targetPlatform}</span>
              <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
              <span className="text-muted w-full text-xs">
                {fmtDateTime(t.createdAt)} · провёл {t.initiatorName} · тикет #{t.ticketNumber}
              </span>
            </div>
          );
        })}
        {outgoing.some((t) => !['refused', 'expired', 'revoked'].includes(t.status)) ? (
          <p className="text-muted text-xs">
            Деньги не переносятся: клиент выводит средства обычной заявкой и пополняет новый счёт сам.
          </p>
        ) : null}
        {!outgoing.length && !inbound ? <p className="text-muted">Переводов не было.</p> : null}
      </div>
    </Panel>
  );
}
