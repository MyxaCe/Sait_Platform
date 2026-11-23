import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState, cn } from '@broker/ui';
import { requireSessionUser } from '@/lib/auth/require';
import { listNotifications } from '@/lib/data';
import { displayParams, notificationKey } from '@/lib/notification-params';
import {
  NOTIFICATION_GROUPS,
  countByGroup,
  notificationGroup,
  parseGroupFilter,
  type NotificationGroup,
} from '@/lib/notification-groups';
import { markAllReadAction, markNotificationReadAction } from '@/lib/actions';
import { FilterChips } from '@/features/history/FilterChips';
import { NavIcon } from '@/features/shell/NavIcon';
import { Card, CARD } from '@/features/ui/Card';
import { PAGE } from '@/features/ui/page';

const GROUP_ICON: Record<NotificationGroup, 'trade' | 'profile' | 'notifications' | 'more'> = {
  trading: 'trade',
  account: 'profile',
  support: 'notifications',
  other: 'more',
};

const LIST_LIMIT = 50;

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { type?: string };
}) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('notifications');
  const format = await getFormatter();
  const notifications = await listNotifications(user.id, LIST_LIMIT);
  const filter = parseGroupFilter(searchParams.type);
  const unread = notifications.filter((n) => !n.readAt).length;
  const counts = countByGroup(notifications.map((n) => n.type));
  const shown = filter === 'all' ? notifications : notifications.filter((n) => notificationGroup(n.type) === filter);
  const filters: (NotificationGroup | 'all')[] = [
    'all',
    ...NOTIFICATION_GROUPS,
    ...(counts.other > 0 || filter === 'other' ? (['other'] as const) : []),
  ];

  const text = (type: string, raw: Record<string, unknown>) => {
    const p = displayParams(type, raw);
    const key = notificationKey(type, p);
    return t.has(`types.${key}` as never) && p !== null
      ? (t as unknown as (key: string, params?: Record<string, unknown>) => string)(`types.${key}`, p)
      : type;
  };

  return (
    <div className={cn(PAGE, 'space-y-4 sm:space-y-5')}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
            <p className="mt-1 text-sm text-secondary">{unread > 0 ? t('unreadLead', { n: unread }) : t('allReadLead')}</p>
          </div>
          {unread > 0 ? (
            <form action={markAllReadAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-lg border border-border px-3.5 text-sm text-secondary transition-colors hover:border-border-strong hover:text-primary"
              >
                {t('markAll')}
              </button>
            </form>
          ) : null}
        </div>

      {/* Одна сетка: фильтры ↔ сводка, список ↔ «Что сюда приходит» — строки одной высоты. */}
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-12 xl:items-stretch" data-notifications-grid>
        {notifications.length > 0 ? (
          <Card as="div" className="xl:col-span-8 xl:col-start-1 xl:row-start-1" bodyClassName="flex items-center" data-notifications-filter>
            <FilterChips
              label={t('filterLabel')}
              active={filter}
              items={filters.map((g) => ({
                key: g,
                label: `${t(`groups.${g}`)} · ${g === 'all' ? notifications.length : counts[g]}`,
                href: g === 'all' ? '/notifications' : `/notifications?type=${g}`,
              }))}
            />
          </Card>
        ) : null}

        <Card
          title={t(`groups.${filter}`)}
          titleId="notif-list"
          flush={shown.length > 0}
          className="xl:col-span-8 xl:col-start-1 xl:row-start-2"
          data-notifications-list
        >
          {shown.length === 0 ? (
            <EmptyState
              size="compact"
              title={notifications.length === 0 ? t('empty') : t('emptyFiltered')}
              description={notifications.length === 0 ? t('emptyHint') : undefined}
            />
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((n) => {
                const group = notificationGroup(n.type);
                return (
                  <li
                    key={n.id}
                    className={cn('flex gap-3 px-4 py-3.5 sm:px-5', !n.readAt && 'bg-accent/[0.04]')}
                    data-notification-group={group}
                    data-read={String(Boolean(n.readAt))}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
                        n.readAt ? 'bg-primary/[0.06] text-secondary' : 'bg-accent/15 text-accent',
                      )}
                    >
                      <NavIcon name={GROUP_ICON[group]} className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm', n.readAt ? 'text-secondary' : 'text-primary')}>{text(n.type, n.params)}</p>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-muted">
                          {t(`groups.${group}`)} · {format.dateTime(n.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                        {!n.readAt ? (
                          <form action={markNotificationReadAction}>
                            <input type="hidden" name="id" value={n.id} />
                            <button type="submit" className="text-xs font-medium text-accent hover:underline">
                              {t('markRead')}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <dl className="grid grid-cols-2 gap-3 sm:gap-4 xl:col-span-4 xl:col-start-9 xl:row-start-1 xl:gap-5" data-notifications-stats>
          <div className={cn(CARD, 'flex flex-col justify-center px-4 py-3 sm:px-5 sm:py-4')}>
            <dt className="text-xs text-muted">{t('statUnread')}</dt>
            <dd className="mt-1 text-[22px] font-semibold leading-8 tabular-nums">{unread}</dd>
          </div>
          <div className={cn(CARD, 'flex flex-col justify-center px-4 py-3 sm:px-5 sm:py-4')}>
            <dt className="text-xs text-muted">{t('statTotal')}</dt>
            <dd className="mt-1 text-[22px] font-semibold leading-8 tabular-nums">{notifications.length}</dd>
          </div>
        </dl>
        <Card title={t('aboutTitle')} titleId="notif-about" className="xl:col-span-4 xl:col-start-9 xl:row-start-2">
          <ul className="space-y-3">
            {NOTIFICATION_GROUPS.map((g) => (
              <li key={g} className="flex gap-3">
                <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/[0.06] text-secondary">
                  <NavIcon name={GROUP_ICON[g]} className="size-[15px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(`groups.${g}`)}</span>
                  <span className="block text-xs text-secondary">{t(`about.${g}`)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">{t('aboutNote')}</p>
        </Card>
      </div>
      {notifications.length >= LIST_LIMIT ? <p className="text-xs text-muted">{t('limitHint', { n: LIST_LIMIT })}</p> : null}
    </div>
  );
}
