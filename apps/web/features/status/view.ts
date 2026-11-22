import { isStatusCheckKey, type LiveStatus } from '@/lib/live-status';

export type ViewStatus = 'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown';
export type StatusMode = 'legacy' | 'live' | 'unavailable';
export type Banner = 'ok' | 'issues' | 'maintenance' | 'unavailable';

export interface CmsService {
  id: string;
  name: string;
  description: string;
  status: 'operational' | 'degraded' | 'outage' | 'maintenance';
  uptime90d: string;
  check?: string | null;
  manualStatus?: 'auto' | 'maintenance';
  maintenanceNote?: string | null;
  maintenanceFrom?: string | null;
  maintenanceTo?: string | null;
}

export type ViewUptime =
  | { kind: 'legacy'; text: string }
  | { kind: 'live'; value: number; days: number | null };

export interface ViewService {
  id: string;
  name: string;
  description: string;
  status: ViewStatus;
  uptime: ViewUptime | null;
  maintenance: { note: string; from: string | null; to: string | null; active: boolean } | null;
}

export interface StatusView {
  mode: StatusMode;
  banner: Banner;
  services: ViewService[];
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export function maintenanceOf(service: CmsService, now: number): ViewService['maintenance'] {
  if (service.manualStatus !== 'maintenance') return null;
  const from = time(service.maintenanceFrom);
  const to = time(service.maintenanceTo);
  if (to !== null && now > to) return null;
  return {
    note: service.maintenanceNote?.trim() ?? '',
    from: from === null ? null : new Date(from).toISOString(),
    to: to === null ? null : new Date(to).toISOString(),
    active: from === null || now >= from,
  };
}

function bannerFor(statuses: ViewStatus[]): Banner {
  if (statuses.some((s) => s === 'degraded' || s === 'outage')) return 'issues';
  if (statuses.some((s) => s === 'maintenance')) return 'maintenance';
  if (statuses.some((s) => s === 'operational')) return 'ok';
  return 'unavailable';
}

export function resolveStatusView(cms: CmsService[], live: LiveStatus, now: number): StatusView {
  if (live.state === 'not-configured') {
    const services = cms.map<ViewService>((s) => {
      const maintenance = maintenanceOf(s, now);
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        status: maintenance?.active ? 'maintenance' : s.manualStatus === 'maintenance' ? 'operational' : s.status,
        uptime: s.uptime90d ? { kind: 'legacy', text: s.uptime90d } : null,
        maintenance,
      };
    });
    const allOk = services.every((s) => s.status === 'operational');
    return { mode: 'legacy', banner: allOk ? 'ok' : 'issues', services };
  }

  const services = cms.map<ViewService>((s) => {
    const maintenance = maintenanceOf(s, now);
    const check = isStatusCheckKey(s.check) && live.state === 'ok' ? live.checks[s.check] : null;
    const status: ViewStatus = maintenance?.active ? 'maintenance' : (check?.status ?? 'unknown');
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      status,
      uptime:
        check && check.uptime !== null ? { kind: 'live', value: check.uptime, days: live.state === 'ok' ? live.periodDays : null } : null,
      maintenance,
    };
  });

  if (live.state === 'unavailable') return { mode: 'unavailable', banner: 'unavailable', services };
  return { mode: 'live', banner: bannerFor(services.map((s) => s.status)), services };
}

export function formatUptime(value: number, locale: string): string {
  const truncated = Math.floor(value * 10_000 + 1e-9) / 10_000;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(truncated);
}
