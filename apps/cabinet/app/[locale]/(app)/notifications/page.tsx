import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { cn } from '@broker/ui';
import { getSessionUser } from '@/lib/auth/session';
import { listNotifications } from '@/lib/data';
import { markAllReadAction, markNotificationReadAction } from '@/lib/actions';

export default async function NotificationsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = (await getSessionUser())!;
  const t = await getTranslations('notifications');
  const format = await getFormatter();
  const notifications = await listNotifications(user.id);
  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {hasUnread && (
          <form action={markAllReadAction}>
            <button type="submit" className="text-sm text-accent hover:underline">
              {t('markAll')}
            </button>
          </form>
        )}
      </div>

      <div className="mt-6">
        {notifications.length === 0 ? (
          <p className="text-sm text-secondary">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={cn(
                  'rounded-xl border p-4',
                  n.readAt ? 'border-border bg-elevated opacity-70' : 'border-accent/40 bg-elevated',
                )}
              >
                <p className="text-sm">
                  {t.has(`types.${n.type}` as never)
                    ? (t as unknown as (key: string, params?: Record<string, unknown>) => string)(
                        `types.${n.type}`,
                        n.params,
                      )
                    : n.type}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-secondary">
                    {format.dateTime(n.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  {!n.readAt && (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <button type="submit" className="text-xs text-accent hover:underline">
                        {t('markRead')}
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
