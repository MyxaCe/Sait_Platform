import { describe, expect, it } from 'vitest';
import type { LiveCheck, LiveStatus, StatusCheckKey } from '@/lib/live-status';
import { formatUptime, resolveStatusView, type CmsService } from './view';

const NOW = Date.parse('2026-11-22T12:00:00Z');

const legacy: CmsService[] = [
  { id: 'svc-0', name: 'Сайт', description: 'd', status: 'operational', uptime90d: '99.99%' },
  { id: 'svc-3', name: 'Платежи', description: 'd', status: 'degraded', uptime90d: '99.92%' },
];

const svc = (over: Partial<CmsService>): CmsService => ({
  id: 'x',
  name: 'n',
  description: 'd',
  status: 'operational',
  uptime90d: '',
  manualStatus: 'auto',
  ...over,
});

function live(checks: Partial<Record<StatusCheckKey, LiveCheck>>, periodDays: number | null = 29): LiveStatus {
  const base: LiveCheck = { status: 'operational', uptime: 1 };
  return {
    state: 'ok',
    periodDays,
    at: NOW,
    checks: {
      site: base,
      cabinet: base,
      terminal: base,
      quotes: base,
      cms: base,
      storage: base,
      ...checks,
    },
  };
}

describe('resolveStatusView', () => {
  it('без мониторинга — всё из CMS, как раньше (старый контракт CMS)', () => {
    const view = resolveStatusView(legacy, { state: 'not-configured' }, NOW);
    expect(view.mode).toBe('legacy');
    expect(view.banner).toBe('issues');
    expect(view.services.map((s) => [s.status, s.uptime])).toEqual([
      ['operational', { kind: 'legacy', text: '99.99%' }],
      ['degraded', { kind: 'legacy', text: '99.92%' }],
    ]);
  });

  it('статус и uptime берутся из мониторинга по ключу проверки', () => {
    const view = resolveStatusView(
      [svc({ id: 'a', check: 'site' }), svc({ id: 'b', check: 'terminal' })],
      live({ terminal: { status: 'outage', uptime: 0.97 } }),
      NOW,
    );
    expect(view.mode).toBe('live');
    expect(view.banner).toBe('issues');
    expect(view.services[1]).toMatchObject({ status: 'outage', uptime: { kind: 'live', value: 0.97, days: 29 } });
  });

  it('CMS-статус operational/degraded в живом режиме игнорируется', () => {
    const view = resolveStatusView([svc({ check: 'site', status: 'degraded' })], live({}), NOW);
    expect(view.services[0]!.status).toBe('operational');
    expect(view.banner).toBe('ok');
  });

  it('ручные «плановые работы» перекрывают автоматический статус', () => {
    const view = resolveStatusView(
      [svc({ check: 'cms', manualStatus: 'maintenance', maintenanceNote: 'Обновление' }), svc({ check: 'site' })],
      live({ cms: { status: 'outage', uptime: 0.5 } }),
      NOW,
    );
    expect(view.services[0]).toMatchObject({
      status: 'maintenance',
      maintenance: { note: 'Обновление', active: true },
    });
    expect(view.banner).toBe('maintenance');
  });

  it('работы в будущем — статус автоматический, анонс виден; после окончания — анонса нет', () => {
    const future = svc({
      check: 'site',
      manualStatus: 'maintenance',
      maintenanceFrom: '2026-11-23T01:00:00Z',
      maintenanceTo: '2026-11-23T02:00:00Z',
    });
    const before = resolveStatusView([future], live({}), NOW);
    expect(before.services[0]).toMatchObject({ status: 'operational', maintenance: { active: false } });
    const after = resolveStatusView([future], live({}), Date.parse('2026-11-23T03:00:00Z'));
    expect(after.services[0]).toMatchObject({ status: 'operational', maintenance: null });
  });

  it('maintenance работает и без мониторинга', () => {
    const view = resolveStatusView([svc({ manualStatus: 'maintenance' })], { state: 'not-configured' }, NOW);
    expect(view.services[0]!.status).toBe('maintenance');
  });

  it('Prometheus недоступен — баннер «временно недоступен», статусы «нет данных»', () => {
    const view = resolveStatusView([svc({ check: 'site' }), svc({ check: 'cms', manualStatus: 'maintenance' })], { state: 'unavailable' }, NOW);
    expect(view.mode).toBe('unavailable');
    expect(view.banner).toBe('unavailable');
    expect(view.services.map((s) => s.status)).toEqual(['unknown', 'maintenance']);
    expect(view.services[0]!.uptime).toBeNull();
  });

  it('сервис без проверки или с неизвестным ключом — «нет данных», баннер не зелёный, если данных нет совсем', () => {
    const view = resolveStatusView([svc({ check: null }), svc({ check: 'payments' })], live({}), NOW);
    expect(view.services.map((s) => s.status)).toEqual(['unknown', 'unknown']);
    expect(view.banner).toBe('unavailable');
  });
});

describe('formatUptime', () => {
  it('не округляет вверх до 100%', () => {
    expect(formatUptime(0.99996, 'en-US')).toBe('99.99%');
    expect(formatUptime(1, 'en-US')).toBe('100%');
    expect(formatUptime(0.9996, 'de-DE')).toMatch(/^99,96\s?%$/);
  });

  it('часть сервисов без данных — не «всё штатно», а честное «по части данных нет»', () => {
    const view = resolveStatusView([svc({ check: 'site' }), svc({ check: null })], live({}), NOW);
    expect(view.services.map((s) => s.status)).toEqual(['operational', 'unknown']);
    expect(view.banner).toBe('partial');
  });
});
