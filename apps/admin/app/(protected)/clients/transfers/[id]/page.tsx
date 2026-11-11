import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Breadcrumbs,
  Callout,
  DataTable,
  DescriptionList,
  EntityHeader,
  Mono,
  Panel,
  ToneBadge,
  cn,
  type DataTableColumn,
} from '@broker/ui';
import { getOutgoingTransfer, listTransferMessages, LIVE_STATUSES, type ChannelMessageRow } from '@broker/transfer';
import { getOperatorSession } from '@/lib/auth/current';
import { getPool } from '@/lib/db';
import { getClientManager } from '@/lib/managers/queries';
import { fmtDateTime } from '@/lib/ui/format';
import { HINT_TEXT, deliveryCodeText, transferStatus } from '@/lib/transfer/labels';
import { canReviewTransfers } from '@/lib/transfer/runtime';
import { CloseSourceForm, RetryDeliveryForm, RevokeTransferForm } from '../../_components/transfer/TransferActions';

/**
 * Перевод (источник): путь по шагам, доказательство инициативы (тикет и
 * сообщение-согласие), подсказки юрисдикций, сообщения канала, действия:
 * «Вернуть перевод» (admin), «Закрыть счёт здесь» (менеджер/admin),
 * «Повторить доставку».
 */
export const dynamic = 'force-dynamic';

const KIND: Record<string, string> = {
  'transfer.package': 'Пакет перевода →',
  'transfer.revoke': 'Возврат →',
  'transfer.status': '← Статус',
};
const STATE: Record<string, { label: string; tone: 'info' | 'positive' | 'negative' | 'neutral' | 'warning' }> = {
  queued: { label: 'в очереди', tone: 'info' },
  sending: { label: 'отправляется', tone: 'info' },
  delivered: { label: 'доставлено', tone: 'positive' },
  refused: { label: 'отказ получателя', tone: 'negative' },
  failed: { label: 'не доставлено', tone: 'negative' },
  cancelled: { label: 'снято', tone: 'neutral' },
  received: { label: 'принято', tone: 'positive' },
};

const MSG_COLUMNS: DataTableColumn<ChannelMessageRow>[] = [
  {
    key: 'kind',
    header: 'Сообщение',
    cell: (m) => (
      <span>
        {m.state === 'received' ? `← ${m.kind === 'transfer.status' ? 'Статус от цели' : m.kind}` : (KIND[m.kind] ?? m.kind)}
        {m.event ? <span className="text-muted block font-mono text-xs">{m.event}</span> : null}
      </span>
    ),
  },
  { key: 'to', header: 'Кому / от кого', mono: true, cell: (m) => m.toPlatform },
  {
    key: 'state',
    header: 'Доставка',
    cell: (m) => {
      const s = STATE[m.state] ?? { label: m.state, tone: 'neutral' as const };
      return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>;
    },
  },
  { key: 'att', header: 'Попыток', numeric: true, cell: (m) => m.attempts },
  {
    key: 'err',
    header: 'Ответ / ошибка',
    cell: (m) => <span className="text-muted text-xs">{deliveryCodeText(m.lastError ?? m.responseCode) ?? '—'}</span>,
  },
  { key: 'at', header: 'Создано', numeric: true, cell: (m) => fmtDateTime(m.createdAt) },
];

function Step({ label, at, done, tone = 'positive' }: { label: string; at: string | null; done: boolean; tone?: 'positive' | 'negative' }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={cn(
          'mt-1 size-2.5 shrink-0 rounded-full',
          done ? (tone === 'negative' ? 'bg-negative' : 'bg-positive') : 'border-border-strong border bg-transparent',
        )}
      />
      <span className="min-w-0">
        <span className={cn('block text-sm', done ? 'text-primary' : 'text-muted')}>{label}</span>
        <span className="text-muted block text-xs tabular-nums">{at ? fmtDateTime(at) : done ? '' : 'ещё нет'}</span>
      </span>
    </li>
  );
}

export default async function TransferDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { created?: string } }) {
  const db = getPool();
  const [t, operator] = await Promise.all([getOutgoingTransfer(db, params.id), getOperatorSession()]);
  if (!t) notFound();
  const isAdmin = canReviewTransfers(operator?.role);
  const manager = await getClientManager(t.userId);
  const isClientManager = manager?.managerId === operator?.operatorId;
  if (!isAdmin && t.initiatorId !== operator?.operatorId && !isClientManager) notFound();

  const [messages, evidence] = await Promise.all([
    listTransferMessages(db, t.id),
    db.query(
      `SELECT m.id, m.body_text, m.created_at, m.channel FROM support_messages m
        WHERE m.id IN (SELECT evidence_message_id FROM platform_transfers WHERE id = $1
                       UNION SELECT consent_message_id FROM platform_transfers WHERE id = $1)`,
      [t.id],
    ),
  ]);
  const ids = await db.query(`SELECT evidence_message_id, consent_message_id, evidence_sha256, package_sha256, consent_text_version FROM platform_transfers WHERE id = $1`, [t.id]);
  const meta = ids.rows[0]!;
  const msg = (id: unknown) => evidence.rows.find((r) => String(r.id) === String(id));
  const first = msg(meta.evidence_message_id);
  const consent = msg(meta.consent_message_id);
  const s = transferStatus(t.status);
  const live = (LIVE_STATUSES as readonly string[]).includes(t.status);
  const registered = ['registered', 'kyc_passed', 'source_closed'].includes(t.status) || Boolean(t.targetRegisteredAt);
  const stalled = messages.some((m) => m.state === 'failed' || (m.state === 'queued' && m.attempts > 0));

  return (
    <div className="space-y-5">
      <Breadcrumbs
        linkComponent={Link}
        items={[
          { label: 'Клиенты', href: '/clients' },
          { label: 'Переводы клиентов', href: '/clients/transfers' },
          { label: t.number },
        ]}
      />
      <EntityHeader
        title={`Перевод ${t.number}`}
        tone={t.status === 'revoked' || t.status === 'refused' ? 'negative' : 'default'}
        badges={<ToneBadge tone={s.tone}>{s.label}</ToneBadge>}
        meta={[
          <Link key="c" href={`/clients/${t.userId}`} className="hover:text-primary">
            {t.clientName}
          </Link>,
          <span key="to">→ {t.targetName ?? t.targetPlatform}</span>,
          <span key="by">провёл: {t.initiatorName}</span>,
          <span key="at">{fmtDateTime(t.createdAt)}</span>,
        ]}
      />

      {searchParams.created ? (
        <Callout tone="positive" title="Перевод проведён">
          Пакет отправлен платформе-цели. Администратор видит перевод в «Переводах клиентов». Клиент получит письмо-приглашение от
          новой платформы и зарегистрируется сам.
        </Callout>
      ) : null}
      {t.status === 'refused' ? (
        <Callout tone="negative" title="Платформа-цель отказала">
          {deliveryCodeText(t.deliveryError) ?? t.deliveryError}. Перевод не состоялся; данные клиента в цели не сохранены.
        </Callout>
      ) : null}
      {t.status === 'revoked' ? (
        <Callout tone="negative" title={`Перевод возвращён${t.revokedByName ? ` — ${t.revokedByName}` : ''}`}>
          Основание: {t.revokeBasis?.replace(/[.\s]+$/, '')}. Стадия: {t.revokeStage === 'after_registration' ? 'клиент уже был зарегистрирован в цели' : 'до регистрации в цели'}.{' '}
          {t.revokeAppliedAt
            ? t.revokeTargetDetail?.stage === 'after_registration'
              ? `Цель заморозила счёт клиента${t.revokeTargetDetail?.fundsOnTarget ? ' и поставила задачу вернуть внесённые средства' : ''}.`
              : 'Цель отозвала приглашение — ссылка недействительна.'
            : 'Ждём подтверждения от цели.'}{' '}
          {t.restoreState === 'pending' ? 'Разморозка торговли здесь — повтором (терминал).' : null}
        </Callout>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel title="Путь перевода" description="Статусы цели приходят подписанными сообщениями">
            <ol className="space-y-3">
              <Step label={`Проведён менеджером (${t.initiatorName})`} at={t.createdAt} done />
              <Step label="Пакет принят платформой-целью" at={t.deliveredAt} done={Boolean(t.deliveredAt)} />
              <Step label="Письмо-приглашение отправлено клиенту" at={t.targetInvitedAt} done={Boolean(t.targetInvitedAt)} />
              <Step label="Клиент зарегистрировался в цели (сам)" at={t.targetRegisteredAt} done={Boolean(t.targetRegisteredAt)} />
              <Step label="Клиент прошёл KYC в цели" at={t.targetKycPassedAt} done={Boolean(t.targetKycPassedAt)} />
              <Step label="Счёт здесь закрыт" at={t.sourceClosedAt} done={Boolean(t.sourceClosedAt)} />
              {t.revokedAt ? <Step label="Перевод возвращён администратором" at={t.revokedAt} done tone="negative" /> : null}
            </ol>
          </Panel>

          <Panel title="Заявление клиента (доказательство инициативы)">
            <DescriptionList
              columns={1}
              items={[
                {
                  term: 'Тикет поддержки',
                  value: (
                    <Link href={`/support/${t.ticketNumber}`} className="text-accent hover:underline">
                      #{t.ticketNumber} — открыть переписку
                    </Link>
                  ),
                  hint: 'первое сообщение тикета написал клиент',
                },
                {
                  term: 'Первое сообщение клиента',
                  value: first ? <span className="italic">«{String(first.body_text).slice(0, 600)}»</span> : '—',
                  hint: first ? fmtDateTime(String(first.created_at instanceof Date ? first.created_at.toISOString() : first.created_at)) : undefined,
                },
                {
                  term: 'Согласие на передачу данных',
                  value: consent ? <span className="italic">«{String(consent.body_text).slice(0, 600)}»</span> : '—',
                  hint: `версия текста согласия: ${meta.consent_text_version}`,
                },
                { term: 'Основание менеджера', value: t.basis },
                { term: 'Хеш доказательства', value: <Mono value={String(meta.evidence_sha256)} /> },
                { term: 'Хеш пакета', value: <Mono value={String(meta.package_sha256 ?? '')} /> },
              ]}
            />
          </Panel>

          <Panel title="Сообщения межплатформенного канала" count={messages.length} flush>
            <DataTable bare columns={MSG_COLUMNS} rows={messages} rowKey={(m) => m.id} aria-label="Сообщения канала" />
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5">
          <Panel title="Подсказки по профилям юрисдикций" description="На момент проведения">
            {t.hints.length ? (
              <ul className="text-secondary list-disc space-y-1.5 pl-4 text-[13px]">
                {t.hints.map((h) => (
                  <li key={h}>{HINT_TEXT[h] ?? h}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted text-[13px]">Подсказок нет: направление допустимо без оговорок.</p>
            )}
          </Panel>

          <Panel title="Деньги клиента">
            <p className="text-secondary text-[13px]">
              Внутреннего переноса нет. Клиент выводит средства отсюда обычной заявкой на вывод и пополняет новый счёт сам.
              Закрыть счёт здесь можно после регистрации клиента в цели и при нулевом балансе.
            </p>
          </Panel>

          {live && registered && (isAdmin || isClientManager) && t.status !== 'source_closed' ? (
            <Panel title="Закрыть счёт здесь" description="По запросу клиента, с основанием">
              <CloseSourceForm transferId={t.id} />
            </Panel>
          ) : null}

          {live && stalled ? (
            <Panel title="Доставка не прошла" description={t.deliveryError ?? 'цель недоступна — идут повторы'}>
              <RetryDeliveryForm transferId={t.id} />
            </Panel>
          ) : null}

          {isAdmin && live ? (
            <Panel title="Вернуть перевод" tone="danger" description="Только администратор. Учитывается у менеджера, проведшего перевод.">
              <RevokeTransferForm
                transferId={t.id}
                number={t.number}
                clientName={t.clientName}
                stage={registered ? 'after_registration' : 'before_registration'}
              />
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
