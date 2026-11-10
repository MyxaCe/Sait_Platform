import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable, DescriptionList, EmptyState, Money, Panel, ToneBadge, type DataTableColumn } from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { bpsText } from '@/lib/promo/labels';
import { getPromoSettings, listPartners, queueCounts, type PartnerRow } from '@/lib/promo/queries';
import { canManagePromo, canViewPromo } from '@/lib/promo/runtime';
import { PromoHeader } from '../_components/PromoHeader';
import { REAL_ACCOUNT_CURRENCY } from '@broker/money';
import { PartnerForm, RevshareForm, SyncForm, type PartnerInitial } from '../_components/PromoForms';

/**
 * IB-партнёры (решение владельца №5): CPA за квалифицированного клиента ИЛИ
 * доля дохода платформы (наценка + комиссия) с привлечённых. Партнёр —
 * клиент платформы; привлекает по своему реф-коду; выплаты — через очередь.
 */
export const dynamic = 'force-dynamic';

const usd = (m: unknown) => (typeof m === 'number' ? (m / 100).toFixed(2) : '');

function terms(p: PartnerRow) {
  if (p.model === 'revshare') return `доля ${bpsText(p.revshareBps ?? 0)} дохода`;
  return (
    <>
      <Money minor={p.cpaAmountMinor} currency={REAL_ACCOUNT_CURRENCY} /> за клиента
    </>
  );
}

function columns(): DataTableColumn<PartnerRow>[] {
  return [
    {
      key: 'name',
      header: 'Партнёр',
      cell: (p) => (
        <Link href={`/promo/partners?p=${p.id}#detail`} scroll={false} className="group block min-w-0">
          <span className="text-primary group-hover:text-accent block truncate font-medium">{p.displayName}</span>
          <span className="text-muted block truncate text-xs">{p.clientEmail}</span>
        </Link>
      ),
    },
    {
      key: 'model',
      header: 'Модель',
      width: '10rem',
      cell: (p) => (
        <span className="block">
          <span className="text-primary block">{p.model === 'cpa' ? 'CPA' : 'Revshare'}</span>
          <span className="text-muted block whitespace-nowrap text-xs">{terms(p)}</span>
        </span>
      ),
    },
    { key: 'code', header: 'Реф-код', mono: true, width: '7rem', cell: (p) => p.code ?? '—' },
    { key: 'clients', header: 'Клиентов', numeric: true, width: '6rem', cell: (p) => p.clients },
    {
      key: 'status',
      header: 'Статус',
      width: '7rem',
      cell: (p) => <ToneBadge tone={p.status === 'active' ? 'positive' : 'warning'}>{p.status === 'active' ? 'Активен' : 'На паузе'}</ToneBadge>,
    },
  ];
}

function initialOf(p: PartnerRow | null): PartnerInitial {
  const r = (p?.cpaRules ?? {}) as Record<string, unknown>;
  return {
    id: p?.id,
    displayName: p?.displayName ?? '',
    model: p?.model ?? 'cpa',
    cpaAmount: usd(p?.cpaAmountMinor ?? null),
    revsharePercent: p?.revshareBps ? String(p.revshareBps / 100) : '',
    status: p?.status ?? 'active',
    kycRequired: p ? r.kycRequired === true : true,
    minDeposit: usd(r.minDepositMinor),
    turnoverNotional: usd(r.turnoverNotionalMinor),
    minHoldSeconds: r.minHoldSeconds === undefined ? '' : String(r.minHoldSeconds),
    windowDays: r.windowDays === undefined ? '' : String(r.windowDays),
  };
}

export default async function PartnersPage({ searchParams }: { searchParams: { p?: string; new?: string } }) {
  const operator = await getOperatorSession();
  if (!canViewPromo(operator?.role)) notFound();
  const isAdmin = canManagePromo(operator?.role);
  const [rows, settings, counts] = await Promise.all([listPartners(), getPromoSettings(), queueCounts()]);
  const selected = rows.find((r) => r.id === searchParams.p) ?? null;
  const creating = isAdmin && searchParams.new === '1';

  return (
    <div className="space-y-6">
      <PromoHeader
        active="partners"
        settings={settings}
        queueCount={counts.pending}
        actions={
          isAdmin ? (
            <Link href="/promo/partners?new=1#detail" className="bg-accent text-on-accent hover:bg-accent-hover inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium">
              Новый партнёр
            </Link>
          ) : null
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel title="IB-партнёры" count={rows.length} flush>
            <DataTable
              bare
              columns={columns()}
              rows={rows}
              rowKey={(r) => r.id}
              selectedKey={selected?.id}
              empty={<EmptyState size="compact" title="Партнёров нет" description="Партнёр — клиент платформы с индивидуальными условиями. Заводит администратор." />}
            />
          </Panel>
          <Panel title="Модели вознаграждения">
            <ul className="text-secondary list-disc space-y-2 pl-4 text-[13px]">
              <li>
                <span className="text-primary font-medium">CPA</span> — фикс за клиента, который в срок прошёл условия партнёра (KYC, депозит,
                оборот со сделками от N секунд). Начисление встаёт в очередь при пересчёте.
              </li>
              <li>
                <span className="text-primary font-medium">Revshare</span> — доля дохода платформы (наценка + комиссия) с привлечённых клиентов за
                закрытый месяц. Без наценки/комиссии в сделках доля — ноль.
              </li>
            </ul>
          </Panel>
        </div>

        <aside id="detail" className="min-w-0 space-y-5">
          {creating ? (
            <Panel title="Новый партнёр" description="Клиенту выдаётся реф-код; его клиенты считаются клиентами партнёра.">
              <PartnerForm initial={initialOf(null)} />
            </Panel>
          ) : null}
          {selected ? (
            <>
              <Panel title={selected.displayName} actions={<Link href={`/clients/${selected.userId}`} className="text-accent text-[13px] font-medium hover:underline">Клиент →</Link>}>
                <DescriptionList
                  columns={2}
                  items={[
                    { term: 'Модель', value: selected.model === 'cpa' ? 'CPA' : 'Revshare' },
                    { term: 'Условия', value: terms(selected) },
                    { term: 'Клиентов', value: String(selected.clients), numeric: true },
                    { term: 'Реф-код', value: selected.code ?? '—' },
                    { term: 'Выплачено', value: <Money minor={selected.paidMinor} currency={REAL_ACCOUNT_CURRENCY} /> },
                    { term: 'В очереди', value: <Money minor={selected.pendingMinor} currency={REAL_ACCOUNT_CURRENCY} /> },
                  ]}
                />
              </Panel>
              {isAdmin ? (
                <Panel title="Изменить условия">
                  <PartnerForm key={selected.id} initial={initialOf(selected)} />
                </Panel>
              ) : null}
              {isAdmin && selected.model === 'revshare' ? (
                <Panel title="Доля за месяц">
                  <RevshareForm id={selected.id} />
                </Panel>
              ) : null}
              {selected.model === 'cpa' ? (
                <Panel title="Пересчёт CPA" description="Квалифицированные клиенты партнёров → в очередь.">
                  <SyncForm />
                </Panel>
              ) : null}
            </>
          ) : !creating ? (
            <Panel title="Партнёр">
              <EmptyState size="compact" title="Выберите партнёра" description="Условия, клиенты, выплаты и формы — здесь." />
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
