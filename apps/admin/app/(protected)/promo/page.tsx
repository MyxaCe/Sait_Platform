import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable, EmptyState, KpiTile, Money, Panel, type DataTableColumn } from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { canManagePromo, canViewPromo } from '@/lib/promo/runtime';
import { getPromoSettings, listPromotionsWithStats, queueCounts, type PromotionListRow } from '@/lib/promo/queries';
import { fmtAge, fmtDate, fmtDateTime } from '@/lib/ui/format';
import { PromoHeader } from './_components/PromoHeader';
import { BudgetBar, PromoStatusBadge, TypeLabel } from './_components/badges';
import { REAL_ACCOUNT_CURRENCY } from '@broker/money';
import { SyncForm } from './_components/PromoForms';

/**
 * «Акции и партнёры» — список акций (концепция §7.1). Роли — admin и
 * finance_operator (у остальных раздела нет: 404). Создание — только admin.
 */
export const dynamic = 'force-dynamic';

function period(p: PromotionListRow) {
  if (!p.startsAt && !p.endsAt) return <span className="text-muted">бессрочно</span>;
  return (
    <span className="block tabular-nums">
      <span className="block">{p.startsAt ? fmtDate(p.startsAt) : 'с запуска'}</span>
      <span className="text-muted block text-xs">до {p.endsAt ? fmtDate(p.endsAt) : 'бессрочно'}</span>
    </span>
  );
}

const columns: DataTableColumn<PromotionListRow>[] = [
  {
    key: 'title',
    header: 'Акция',
    cell: (p) => (
      <Link href={`/promo/${p.id}`} className="group block min-w-0">
        <span className="text-primary group-hover:text-accent block truncate font-medium">{p.title}</span>
        <span className="text-muted block truncate font-mono text-xs">{p.slug}</span>
      </Link>
    ),
  },
  { key: 'type', header: 'Тип', width: '9.5rem', cell: (p) => <TypeLabel type={p.type} /> },
  { key: 'status', header: 'Статус', width: '8rem', cell: (p) => <PromoStatusBadge status={p.status} /> },
  { key: 'period', header: 'Период', width: '12rem', cell: period },
  { key: 'participants', header: 'Участники', numeric: true, width: '6.5rem', cell: (p) => p.participants },
  {
    key: 'pending',
    header: 'К начислению, USDT',
    numeric: true,
    width: '10rem',
    cell: (p) =>
      p.pendingCount > 0 ? (
        <span className="inline-flex flex-col items-end">
          <Money minor={p.pendingMinor} currency={REAL_ACCOUNT_CURRENCY} hideCurrency className="text-warning font-medium" />
          <span className="text-muted text-xs">начислений: {p.pendingCount}</span>
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { key: 'budget', header: 'Бюджет: одобрено / всего, USDT', width: '14rem', cell: (p) => <BudgetBar spent={p.spentMinor} budget={p.budgetMinor} /> },
];

export default async function PromotionsPage() {
  const operator = await getOperatorSession();
  if (!canViewPromo(operator?.role)) notFound();
  const isAdmin = canManagePromo(operator?.role);
  const [promos, settings, counts] = await Promise.all([listPromotionsWithStats(), getPromoSettings(), queueCounts()]);

  const active = promos.filter((p) => p.status === 'active');
  const budget = promos.filter((p) => p.status !== 'draft').reduce((s, p) => s + p.budgetMinor, 0);
  const spent = promos.reduce((s, p) => s + p.spentMinor, 0);
  const credited = promos.reduce((s, p) => s + p.creditedMinor, 0);

  return (
    <div className="space-y-6">
      <PromoHeader
        active="promotions"
        settings={settings}
        queueCount={counts.pending}
        actions={
          isAdmin ? (
            <Link
              href="/promo/new"
              className="bg-accent text-on-accent hover:bg-accent-hover inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium"
            >
              Новая акция
            </Link>
          ) : null
        }
      />

      <section aria-label="Сводка акций" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Идут сейчас" value={active.length} hint={`всего акций: ${promos.length}`} />
        <KpiTile
          label="Ждут решения"
          value={counts.pending}
          tone={counts.pending > 0 ? 'warning' : 'default'}
          hint={
            counts.pending > 0 ? (
              <>
                <Money minor={counts.pendingMinor} currency={REAL_ACCOUNT_CURRENCY} />
                {counts.oldest ? ` · старейшее ${fmtAge(counts.oldest)}` : ''}
              </>
            ) : (
              'очередь пуста'
            )
          }
          action={
            <Link href="/promo/queue" className="text-accent font-medium hover:underline">
              Открыть →
            </Link>
          }
        />
        <KpiTile
          label="Бюджет одобрен"
          value={<Money minor={spent} currency={REAL_ACCOUNT_CURRENCY} />}
          hint={
            <>
              из <Money minor={budget} currency={REAL_ACCOUNT_CURRENCY} />
            </>
          }
        />
        <KpiTile label="Зачислено клиентам" value={<Money minor={credited} currency={REAL_ACCOUNT_CURRENCY} />} hint="реальными USDT через терминал" />
      </section>

      <Panel title="Акции" count={promos.length} flush footer={<span className="text-muted text-xs">Срез на {fmtDateTime(new Date())}</span>}>
        <DataTable
          bare
          columns={columns}
          rows={promos}
          rowKey={(p) => p.id}
          rowTone={(p) => (p.pendingCount > 0 ? 'warning' : undefined)}
          empty={
            <EmptyState
              size="compact"
              title="Акций пока нет"
              description={isAdmin ? 'Создайте черновик: условия, бюджет и тексты задаются в форме.' : 'Акции заводит администратор.'}
            />
          }
        />
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel title="Пересчёт IB-партнёров (CPA)" description="Квалифицированные клиенты партнёров с моделью CPA → в очередь начислений. Акции пересчитываются в своих карточках.">
          <SyncForm />
        </Panel>
        <Panel title="Как деньги доходят до клиента">
          <ol className="text-secondary list-decimal space-y-2 pl-4 text-[13px]">
            <li>Клиент выполняет условия — движок ставит начисление в очередь с сигналами связанности.</li>
            <li>Оператор одобряет с основанием; сумма резервируется в бюджете акции (сверх бюджета — отказ).</li>
            <li>Терминал зачисляет USDT на реальный счёт с идентификатором начисления — повтор безопасен.</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}
