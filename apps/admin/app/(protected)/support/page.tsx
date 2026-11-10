import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  DataTable,
  EmptyState,
  KpiTile,
  PageHeader,
  Pagination,
  Panel,
  StatusBadge,
  Tabs,
  type DataTableColumn,
} from '@broker/ui';
import {
  QUEUE_FILTERS,
  listQueue,
  loadSupportSettings,
  queueStats,
  readMailChannelState,
  supportAccess,
  type Channel,
  type QueueFilter,
  type QueueRow,
} from '@broker/support';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { getPool } from '@/lib/db';
import { supportActor } from '@/lib/support/runtime';
import { CHANNEL_LABEL, CHANNEL_SHORT, QUEUE_FILTER_LABEL, STATUS_KEY } from '@/lib/support/labels';
import { fmtAge, fmtDateTime } from '@/lib/ui/format';
import { FilterBar } from '../clients/_components/FilterBar';
import { AutoRefresh } from './_components/AutoRefresh';
import { MailStatusCallout } from './_components/MailStatus';
import { SupportNav } from './_components/SupportNav';

/**
 * Очередь «Поддержка» (концепция §7.1: очередь — «что старейшее / что горит»).
 * Ждущие ответа сортируются по сроку SLA первого ответа (рабочие часы из
 * настроек); просроченные — полоска `warning` и возраст `text-warning`.
 * Видимость — по роли в самом запросе (finance_operator — только своё).
 * Обновляется опросом раз в 10 с.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const TABS: QueueFilter[] = ['awaiting', 'mine', 'unassigned', 'waiting', 'resolved', 'all'];

function asFilter(v: string | undefined): QueueFilter {
  return QUEUE_FILTERS.includes(v as QueueFilter) ? (v as QueueFilter) : 'awaiting';
}

function href(p: { f?: QueueFilter; ch?: string; q?: string; page?: number }): string {
  const sp = new URLSearchParams();
  if (p.f && p.f !== 'awaiting') sp.set('f', p.f);
  if (p.ch) sp.set('ch', p.ch);
  if (p.q) sp.set('q', p.q);
  if (p.page && p.page > 1) sp.set('page', String(p.page));
  const s = sp.toString();
  return s ? `/support?${s}` : '/support';
}

function slaCell(r: QueueRow) {
  const awaiting = r.status === 'new' || r.status === 'open';
  if (!awaiting) return <span className="text-muted text-xs">{fmtDateTime(r.updatedAt)}</span>;
  const since = r.lastClientMessageAt ?? r.createdAt;
  const due = r.firstRespondedAt ? null : r.firstResponseDueAt;
  return (
    <span className="inline-flex flex-col items-end">
      <span className={r.overdue ? 'text-warning font-medium' : 'text-primary'}>{fmtAge(since)}</span>
      <span className={r.overdue ? 'text-warning text-xs' : 'text-muted text-xs'}>
        {due ? (r.overdue ? `SLA просрочен ${fmtDateTime(due)}` : `ответить до ${fmtDateTime(due)}`) : 'ждёт ответа'}
      </span>
    </span>
  );
}

const COLUMNS: DataTableColumn<QueueRow>[] = [
  {
    key: 'ticket',
    header: 'Обращение',
    cell: (r) => (
      <Link href={`/support/${r.number}`} className="group block min-w-0">
        <span className="text-primary group-hover:text-accent block truncate font-medium">
          <span className="text-muted tabular-nums">#{r.number}</span> {r.subject}
        </span>
        <span className="text-muted block truncate text-xs">
          {r.clientName ?? r.contactName ?? 'Гость'} · {r.contactEmail}
          {r.userId ? null : ' · не клиент'}
        </span>
      </Link>
    ),
  },
  { key: 'channel', header: 'Канал', width: '6.5rem', cell: (r) => <span className="text-secondary">{CHANNEL_SHORT[r.originChannel]}</span> },
  { key: 'status', header: 'Статус', width: '9rem', cell: (r) => <StatusBadge status={STATUS_KEY[r.status]} /> },
  {
    key: 'assignee',
    header: 'Назначен',
    width: '10rem',
    cell: (r) => (r.assigneeName ? <span className="truncate">{r.assigneeName}</span> : <span className="text-muted">—</span>),
  },
  { key: 'age', header: 'Ждёт / SLA', numeric: true, width: '12rem', cell: slaCell },
  {
    key: 'go',
    header: <span className="sr-only">Действие</span>,
    width: '6.5rem',
    align: 'right',
    cell: (r) => (
      <Link href={`/support/${r.number}`} className="text-accent whitespace-nowrap text-[13px] font-medium hover:underline">
        {r.status === 'new' || r.status === 'open' ? 'Ответить' : 'Открыть'}
      </Link>
    ),
  },
];

export default async function SupportQueuePage({ searchParams }: { searchParams: { f?: string; ch?: string; q?: string; page?: string } }) {
  const actor = await supportActor();
  if (!actor) redirect(LOGIN_PATH);
  const filter = asFilter(searchParams.f);
  const channel = (['chat', 'email', 'web_form'] as const).includes(searchParams.ch as Channel) ? (searchParams.ch as Channel) : null;
  const q = (searchParams.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const db = getPool();

  const [stats, list, mail, settings] = await Promise.all([
    queueStats(db, actor),
    listQueue(db, actor, { filter, channel, q, page, pageSize: PAGE_SIZE }),
    readMailChannelState(db),
    loadSupportSettings(db),
  ]);
  const isAdmin = supportAccess.managesSettings(actor.role);
  const filtered = Boolean(channel || q);

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={10} />
      <PageHeader
        title="Поддержка"
        description="Обращения клиентов из чата кабинета, почты и формы сайта. Сверху — то, что горит по SLA первого ответа."
        meta={
          <span className="tabular-nums">
            Срез на {fmtDateTime(new Date())} · обновляется каждые 10 с
            {actor.role === 'finance_operator' ? ' · показаны только назначенные вам' : ''}
          </span>
        }
      />

      <MailStatusCallout state={mail} emailEnabled={settings.channels.email} isAdmin={isAdmin} />

      <section aria-label="Очередь поддержки" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Ждут ответа"
          value={stats.awaiting}
          tone={stats.awaiting > 0 ? 'warning' : 'default'}
          hint={stats.oldestAwaitingAt ? `старейшее ждёт ${fmtAge(stats.oldestAwaitingAt)}` : 'очередь пуста'}
          action={
            <Link href={href({ f: 'awaiting' })} className="text-accent font-medium hover:underline">
              Открыть →
            </Link>
          }
        />
        <KpiTile
          label="Просрочен SLA"
          value={stats.overdue}
          tone={stats.overdue > 0 ? 'negative' : 'default'}
          hint={`первый ответ: чат ${settings.sla.chatFirstResponseMinutes} мин, почта ${settings.sla.emailFirstResponseMinutes} мин`}
        />
        <KpiTile
          label="Не назначены"
          value={stats.unassigned}
          tone={stats.unassigned > 0 ? 'warning' : 'default'}
          hint={stats.mine > 0 ? `на мне: ${stats.mine}` : 'на мне ничего'}
          action={
            <Link href={href({ f: 'unassigned' })} className="text-accent font-medium hover:underline">
              Открыть →
            </Link>
          }
        />
        <KpiTile
          label="Решено за 24 ч"
          value={stats.resolvedToday}
          tone={stats.resolvedToday > 0 ? 'positive' : 'default'}
          hint={stats.csatAvg !== null ? `оценка клиентов ${stats.csatAvg.toFixed(1).replace('.', ',')} из 5 (${stats.csatCount})` : 'оценок пока нет'}
        />
      </section>

      <SupportNav active="queue" isAdmin={isAdmin} awaiting={stats.awaiting} />

      <Tabs
        linkComponent={Link}
        active={filter}
        aria-label="Фильтр очереди"
        items={TABS.map((f) => ({
          key: f,
          label: QUEUE_FILTER_LABEL[f],
          href: href({ f, ch: channel ?? undefined, q }),
          count: f === 'awaiting' ? stats.awaiting : f === 'mine' ? stats.mine : f === 'unassigned' ? stats.unassigned : f === 'waiting' ? stats.waiting : undefined,
          countTone: f === 'awaiting' && stats.overdue > 0 ? 'warning' : 'default',
        }))}
      />

      <Panel flush>
        <DataTable
          bare
          aria-label="Обращения"
          columns={COLUMNS}
          rows={list.rows}
          rowKey={(r) => r.id}
          rowTone={(r) => (r.overdue ? 'warning' : r.status === 'spam' ? 'negative' : undefined)}
          toolbar={
            <FilterBar
              action="/support"
              hidden={{ f: filter === 'awaiting' ? undefined : filter }}
              search={{ name: 'q', value: q, placeholder: '#номер, тема, email, имя', label: 'Поиск' }}
              selects={[
                {
                  name: 'ch',
                  label: 'Канал',
                  value: channel ?? '',
                  options: [
                    { value: '', label: 'Все каналы' },
                    ...(['chat', 'email', 'web_form'] as const).map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
                  ],
                },
              ]}
              resetHref={filtered ? href({ f: filter }) : null}
              aside={<span className="text-muted text-xs tabular-nums">Найдено: {list.total}</span>}
            />
          }
          empty={
            filtered ? (
              <EmptyState
                size="compact"
                title="Ничего не найдено"
                description="Под фильтр не подошло ни одно обращение."
                action={
                  <Link href={href({ f: filter })} className="text-accent text-sm font-medium hover:underline">
                    Сбросить фильтр
                  </Link>
                }
              />
            ) : (
              <EmptyState
                size="compact"
                title={filter === 'awaiting' ? 'Очередь пуста — все ответы даны' : 'Здесь пусто'}
                description={
                  filter === 'awaiting'
                    ? 'Новые обращения из чата, почты и формы сайта появятся здесь сами.'
                    : 'В этом срезе обращений нет.'
                }
              />
            )
          }
          footer={
            list.total > PAGE_SIZE ? (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={list.total}
                hrefFor={(p) => href({ f: filter, ch: channel ?? undefined, q, page: p })}
                linkComponent={Link}
              />
            ) : undefined
          }
        />
      </Panel>
    </div>
  );
}
