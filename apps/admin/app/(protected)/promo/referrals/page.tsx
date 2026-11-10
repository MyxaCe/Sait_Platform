import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable, DescriptionList, EmptyState, Mono, Panel, ToneBadge, type DataTableColumn } from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { ATTRIBUTION_SOURCE, ATTRIBUTION_STATUS, SELF_REFERRAL_REASON } from '@/lib/promo/labels';
import { getPromoSettings, listAttributions, queueCounts, referrerTotals, type AttributionRow } from '@/lib/promo/queries';
import { canManagePromo, canViewPromo } from '@/lib/promo/runtime';
import { fmtDateTime } from '@/lib/ui/format';
import { PromoHeader } from '../_components/PromoHeader';
import { ReassignForm } from '../_components/PromoForms';

/**
 * Рефералы: кто кого привёл (first-click, срок — из настроек платформы),
 * источник, отсечённые самореферала. Переназначение — только admin, с
 * основанием (решение владельца №8).
 */
export const dynamic = 'force-dynamic';

function StatusCell({ a }: { a: AttributionRow }) {
  const m = ATTRIBUTION_STATUS[a.status];
  return (
    <span className="inline-flex flex-col gap-0.5">
      <ToneBadge tone={m?.tone ?? 'neutral'}>{m?.label ?? a.status}</ToneBadge>
      {a.rejectReason ? <span className="text-muted text-xs">{SELF_REFERRAL_REASON[a.rejectReason] ?? a.rejectReason}</span> : null}
    </span>
  );
}

function columns(): DataTableColumn<AttributionRow>[] {
  return [
    {
      key: 'referee',
      header: 'Клиент',
      cell: (a) => (
        <Link href={`/promo/referrals?a=${a.refereeId}#detail`} scroll={false} className="group block min-w-0">
          <span className="text-primary group-hover:text-accent block truncate font-medium">{a.refereeName}</span>
          <span className="text-muted block truncate text-xs">{a.refereeEmail}</span>
        </Link>
      ),
    },
    {
      key: 'referrer',
      header: 'Кто привёл',
      cell: (a) =>
        a.referrerId ? (
          <Link href={`/clients/${a.referrerId}`} className="group block min-w-0">
            <span className="text-primary group-hover:text-accent block truncate">{a.referrerName}</span>
            <span className="text-muted block truncate text-xs">{a.ibPartnerName ? `IB · ${a.ibPartnerName}` : a.referrerEmail}</span>
          </Link>
        ) : (
          <span className="text-muted">{a.promoSlug ? 'только акция' : '—'}</span>
        ),
    },
    {
      key: 'source',
      header: 'Источник',
      width: '12rem',
      cell: (a) => (
        <span className="block max-w-[12rem] min-w-0">
          <span className="text-secondary block text-[13px]">{ATTRIBUTION_SOURCE[a.source] ?? a.source}</span>
          <span className="text-muted block truncate font-mono text-xs" title={[a.code, a.promoSlug].filter(Boolean).join(" · ")}>
            {[a.code, a.promoSlug ? `?promo=${a.promoSlug}` : null].filter(Boolean).join(' · ') || '—'}
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Статус', width: '9.5rem', cell: (a) => <StatusCell a={a} /> },
  ];
}

export default async function ReferralsPage({ searchParams }: { searchParams: { a?: string } }) {
  const operator = await getOperatorSession();
  if (!canViewPromo(operator?.role)) notFound();
  const isAdmin = canManagePromo(operator?.role);
  const [rows, top, settings, counts] = await Promise.all([listAttributions(), referrerTotals(), getPromoSettings(), queueCounts()]);
  const selected = rows.find((r) => r.refereeId === searchParams.a);
  const rejected = rows.filter((r) => r.status === 'rejected').length;

  return (
    <div className="space-y-6">
      <PromoHeader active="referrals" settings={settings} queueCount={counts.pending} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Атрибуции"
          count={rows.length}
          description={`First-click, срок ${settings?.attributionWindowDays ?? '—'} дн (настройки платформы). Отсечено самореферала: ${rejected}.`}
          flush
        >
          <DataTable
            bare
            columns={columns()}
            rows={rows}
            rowKey={(r) => r.refereeId}
            selectedKey={selected?.refereeId}
            rowTone={(r) => (r.status === 'rejected' ? 'negative' : undefined)}
            empty={<EmptyState size="compact" title="Атрибуций нет" description="Появятся, когда клиенты зарегистрируются по реф-ссылке (?ref=КОД) или ссылке акции (?promo=код)." />}
          />
        </Panel>

        <aside id="detail" className="min-w-0 space-y-5">
          {selected ? (
            <Panel title="Атрибуция клиента" actions={<ToneBadge tone={ATTRIBUTION_STATUS[selected.status]?.tone ?? 'neutral'}>{ATTRIBUTION_STATUS[selected.status]?.label ?? selected.status}</ToneBadge>}>
              <div className="space-y-4">
                <DescriptionList
                  columns={1}
                  items={[
                    { term: 'Клиент', value: <Link href={`/clients/${selected.refereeId}`} className="text-accent hover:underline">{selected.refereeName}</Link>, hint: selected.refereeEmail },
                    ...(selected.rejectReason ? [{ term: 'Почему отсечена', value: SELF_REFERRAL_REASON[selected.rejectReason] ?? selected.rejectReason, tone: 'negative' as const }] : []),
                    { term: 'Регистрация', value: fmtDateTime(selected.attributedAt) },
                    { term: 'Кто привёл', value: selected.referrerName ?? '—', hint: selected.ibPartnerName ? `IB-партнёр ${selected.ibPartnerName}` : selected.referrerEmail ?? undefined },
                    { term: 'Код / акция', value: [selected.code, selected.promoSlug].filter(Boolean).join(' · ') || '—' },
                    { term: 'Первый клик', value: selected.firstClickAt ? fmtDateTime(selected.firstClickAt) : '—' },
                    { term: 'IP регистрации', value: selected.ip ? <Mono value={selected.ip} /> : '—', hint: selected.refereeCountry ? `страна из формы: ${selected.refereeCountry}` : undefined },
                  ]}
                />
                {isAdmin ? (
                  <div className="border-border border-t pt-4">
                    <ReassignForm key={selected.refereeId} refereeUserId={selected.refereeId} hasReferrer={!!selected.referrerId && selected.status !== 'revoked'} />
                  </div>
                ) : (
                  <p className="text-muted text-xs">Переназначение реферера — действие администратора.</p>
                )}
              </div>
            </Panel>
          ) : null}
          <Panel title="Кто приводит больше всех" flush>
            <DataTable
              bare
              density="compact"
              columns={[
                {
                  key: 'n',
                  header: 'Реферер',
                  cell: (t) => (
                    <Link href={`/clients/${t.userId}`} className="text-primary hover:text-accent block truncate">
                      {t.name}
                    </Link>
                  ),
                },
                { key: 'c', header: 'Код', mono: true, width: '7rem', cell: (t) => t.code ?? '—' },
                { key: 'i', header: 'Привёл', numeric: true, width: '5rem', cell: (t) => t.invited },
              ]}
              rows={top}
              rowKey={(t) => t.userId}
              empty={<EmptyState size="compact" title="Пока никого" />}
            />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
