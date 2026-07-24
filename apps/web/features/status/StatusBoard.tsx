'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useConnectionStatus } from '@broker/realtime';
import { cn } from '@broker/ui';
import { formatDate } from '@broker/utils';

type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'maintenance';

const DOT: Record<ServiceStatus, string> = {
  operational: 'bg-positive',
  degraded: 'bg-accent',
  outage: 'bg-negative',
  maintenance: 'bg-secondary',
};

const TEXT: Record<ServiceStatus, string> = {
  operational: 'text-positive',
  degraded: 'text-accent',
  outage: 'text-negative',
  maintenance: 'text-secondary',
};

export interface StatusBoardProps {
  /** Данные из CMS (тег cms:system-status); сервис id=quotes-ws подменяется live-состоянием */
  services: {
    id: string;
    name: string;
    description: string;
    status: ServiceStatus;
    uptime90d: string;
  }[];
  incidents: { date: string; title: string; status: string; text: string }[];
}

export function StatusBoard({ services: cmsServices, incidents }: StatusBoardProps) {
  const t = useTranslations('status');
  const locale = useLocale();
  const intlLocale = locale === 'en' ? 'en-US' : 'ru-RU';

  const wsStatus = useConnectionStatus();
  // 'connecting' — нормальное состояние первой загрузки, не тревожим пользователя
  const feedStatus: ServiceStatus =
    wsStatus === 'offline' ? 'outage' : wsStatus === 'reconnecting' ? 'degraded' : 'operational';

  const stateLabel = (s: ServiceStatus) =>
    s === 'operational'
      ? t('stateOperational')
      : s === 'degraded'
        ? t('stateDegraded')
        : s === 'outage'
          ? t('stateOutage')
          : t('stateMaintenance');

  const services = cmsServices.map((s) =>
    s.id === 'quotes-ws' ? { ...s, status: feedStatus } : s,
  );
  const allOk = services.every((s) => s.status === 'operational');

  return (
    <div>
      {/* Общий баннер */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border p-5',
          allOk ? 'border-positive/40 bg-positive/5' : 'border-accent/40 bg-accent/5',
        )}
        role="status"
      >
        <span
          className={cn('size-3 shrink-0 rounded-full', allOk ? 'bg-positive' : 'bg-accent animate-pulse')}
        />
        <p className="font-semibold text-primary">
          {allOk ? t('bannerOk') : t('bannerIssues')}
        </p>
      </div>

      {/* Сервисы */}
      <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {services.map((service) => (
          <li key={service.id} className="flex items-center gap-4 bg-card px-5 py-4">
            <span className={cn('size-2.5 shrink-0 rounded-full', DOT[service.status])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-primary">{service.name}</p>
              <p className="truncate text-xs text-secondary">{service.description}</p>
            </div>
            <div className="text-right">
              <p className={cn('text-sm font-medium', TEXT[service.status])}>
                {stateLabel(service.status)}
              </p>
              <p className="text-xs tabular-nums text-secondary">
                {t('uptime', { value: service.uptime90d })}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* История инцидентов */}
      <h2 className="mt-12 text-xl font-semibold text-primary">{t('incidentsTitle')}</h2>
      <div className="mt-4 space-y-4">
        {incidents.map((incident) => (
          <article key={incident.date} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <time dateTime={incident.date} className="text-secondary">
                {formatDate(incident.date, intlLocale)}
              </time>
              <span className="rounded-full bg-positive/10 px-2.5 py-0.5 font-medium text-positive">
                {incident.status}
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
