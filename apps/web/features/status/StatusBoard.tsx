'use client';

import { intlTag } from '@/lib/locale';
import { useLocale, useTranslations } from 'next-intl';
import { useConnectionStatus } from '@broker/realtime';
import { cn } from '@broker/ui';
import { formatDate } from '@broker/utils';
import { formatUptime, type Banner, type StatusView, type ViewService, type ViewStatus } from './view';

const DOT: Record<ViewStatus, string> = {
  operational: 'bg-positive',
  degraded: 'bg-accent',
  outage: 'bg-negative',
  maintenance: 'bg-secondary',
  unknown: 'bg-border',
};

const TEXT: Record<ViewStatus, string> = {
  operational: 'text-positive',
  degraded: 'text-accent',
  outage: 'text-negative',
  maintenance: 'text-secondary',
  unknown: 'text-secondary',
};

const STATE_KEY = {
  operational: 'stateOperational',
  degraded: 'stateDegraded',
  outage: 'stateOutage',
  maintenance: 'stateMaintenance',
  unknown: 'stateUnknown',
} as const;

const BANNER_KEY = {
  ok: 'bannerOk',
  partial: 'bannerPartial',
  issues: 'bannerIssues',
  maintenance: 'bannerMaintenance',
  unavailable: 'bannerUnavailable',
} as const;

const INCIDENT_KEY = {
  investigating: 'incidentInvestigating',
  fixing: 'incidentFixing',
  resolved: 'incidentResolved',
} as const;

export interface StatusIncident {
  date: string;
  title: string;
  status: string;
  state?: 'investigating' | 'fixing' | 'resolved' | null;
  text: string;
}

export interface StatusBoardProps {
  view: StatusView;
  incidents: StatusIncident[];
}

export function StatusBoard({ view, incidents }: StatusBoardProps) {
  const t = useTranslations('status');
  const locale = useLocale();
  const intlLocale = intlTag(locale);

  const wsStatus = useConnectionStatus();
  const feedStatus: ViewStatus =
    wsStatus === 'offline' ? 'outage' : wsStatus === 'reconnecting' ? 'degraded' : 'operational';

  const services: ViewService[] =
    view.mode === 'legacy'
      ? view.services.map((s) => (s.id === 'quotes-ws' && s.status !== 'maintenance' ? { ...s, status: feedStatus } : s))
      : view.services;
  const banner: Banner =
    view.mode === 'legacy' ? (services.every((s) => s.status === 'operational') ? 'ok' : 'issues') : view.banner;

  const when = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
      new Date(iso),
    );

  const uptimeText = (s: ViewService) => {
    if (!s.uptime) return null;
    if (s.uptime.kind === 'legacy') return t('uptime', { value: s.uptime.text });
    const value = formatUptime(s.uptime.value, intlLocale);
    if (s.uptime.days === null) return t('uptimePlain', { value });
    if (s.uptime.days < 1) return t('uptimeUnderDay', { value });
    return t('uptimeDays', { value, days: s.uptime.days });
  };

  const maintenanceText = (m: NonNullable<ViewService['maintenance']>) => {
    const period =
      m.from && m.to
        ? t('maintenanceWindow', { from: when(m.from), to: when(m.to) })
        : m.to
          ? t('maintenanceUntil', { to: when(m.to) })
          : m.from
            ? t('maintenanceFrom', { from: when(m.from) })
            : null;
    return [m.active ? null : t('maintenancePlanned'), period, m.note || null].filter(Boolean).join(' · ');
  };

  return (
    <div data-testid="status-board" data-mode={view.mode}>
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border p-5',
          banner === 'ok' ? 'border-positive/40 bg-positive/5' : 'border-accent/40 bg-accent/5',
        )}
        role="status"
        data-testid="status-banner"
        data-banner={banner}
      >
        <span
          className={cn(
            'size-3 shrink-0 rounded-full',
            banner === 'ok' ? 'bg-positive' : banner === 'issues' ? 'bg-accent animate-pulse' : 'bg-secondary',
          )}
        />
        <p className="font-semibold text-primary">{t(BANNER_KEY[banner])}</p>
      </div>

      <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {services.map((service, i) => {
          const uptime = uptimeText(service);
          return (
            <li key={`${service.id}-${i}`} className="flex items-center gap-4 bg-card px-5 py-4">
              <span className={cn('size-2.5 shrink-0 rounded-full', DOT[service.status])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-primary">{service.name}</p>
                <p className="truncate text-xs text-secondary">{service.description}</p>
                {service.maintenance && (
                  <p className="mt-1 text-xs text-secondary">{maintenanceText(service.maintenance)}</p>
                )}
              </div>
              <div className="text-right">
                <p className={cn('text-sm font-medium', TEXT[service.status])}>
                  {t(STATE_KEY[service.status])}
                </p>
                {uptime && <p className="text-xs tabular-nums text-secondary">{uptime}</p>}
              </div>
            </li>
          );
        })}
      </ul>

      <h2 className="mt-12 text-xl font-semibold text-primary">{t('incidentsTitle')}</h2>
      <div className="mt-4 space-y-4">
        {incidents.map((incident, i) => (
          <article key={`${incident.date}-${i}`} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <time dateTime={incident.date} className="text-secondary">
                {formatDate(incident.date, intlLocale)}
              </time>
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 font-medium',
                  !incident.state || incident.state === 'resolved'
                    ? 'bg-positive/10 text-positive'
                    : 'bg-accent/10 text-accent',
                )}
              >
                {incident.state ? t(INCIDENT_KEY[incident.state]) : incident.status}
              </span>
            </div>
            <h3 className="mt-2 font-medium text-primary">{incident.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-secondary">{incident.text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
