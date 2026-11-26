import Link from 'next/link';
import { Panel, ToneBadge, cn } from '@broker/ui';
import { listPortfolios } from '@/lib/leverage/queries';
import { LEVERAGE_CLASSES, LEVERAGE_CLASS_LABELS } from '@/lib/leverage/classes';
import { getOperatorSession } from '@/lib/auth/current';
import { formatLeverage } from '@/lib/leverage/resolve';
import { RiskHeader } from '../_components/RiskHeader';
import { countClientsInDefaultImplicitly } from '../_components/queries';
import { PortfolioEditor } from './_components/PortfolioEditor';
import { bpsText } from '@/lib/promo/labels';
import { formatUsdt } from '@/lib/leverage/tier';

export const dynamic = 'force-dynamic';

export default async function PortfoliosPage({
  searchParams,
}: {
  searchParams: { edit?: string };
}) {
  const [portfolios, operator, implicit] = await Promise.all([
    listPortfolios(),
    getOperatorSession(),
    countClientsInDefaultImplicitly(),
  ]);
  const clientsOf = (p: { clientCount: number; isDefault: boolean }) =>
    p.clientCount + (p.isDefault ? implicit : 0);
  const isAdmin = operator?.role === 'admin';
  const editing = isAdmin ? portfolios.find((p) => p.key === searchParams.edit) : undefined;

  return (
    <div className="space-y-6">
      <RiskHeader active="portfolios" canEdit={isAdmin} />

      <section aria-label="Портфели плеча" className="grid gap-5 lg:grid-cols-3">
        {portfolios.map((p) => {
          const selected = editing?.key === p.key;
          return (
            <Panel
              key={p.key}
              title={
                <span className="flex items-center gap-2">
                  {p.title}
                  {p.isDefault ? <ToneBadge tone="neutral" plain>по умолчанию</ToneBadge> : null}
                </span>
              }
              actions={
                isAdmin ? (
                  <Link
                    href={selected ? '/risk/portfolios' : `/risk/portfolios?edit=${p.key}#edit`}
                    className="text-accent text-[13px] font-medium hover:underline"
                  >
                    {selected ? 'Закрыть' : 'Изменить'}
                  </Link>
                ) : null
              }
              className={cn(selected && 'ring-accent/40 ring-1')}
            >
              <div data-portfolio={p.key} className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-muted text-xs">Базовое плечо</p>
                    <p className="text-primary text-2xl font-semibold tabular-nums tracking-tight">
                      {formatLeverage(p.baseLeverage)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted text-xs">Клиентов</p>
                    <p className="text-primary text-sm font-medium tabular-nums">{clientsOf(p)}</p>
                  </div>
                </div>
                <dl className="border-border grid grid-cols-3 gap-3 border-t pt-3" data-leverage-classes>
                  {LEVERAGE_CLASSES.map((c) => (
                    <div key={c} data-class={c}>
                      <dt className="text-muted text-xs">{LEVERAGE_CLASS_LABELS[c]}</dt>
                      <dd className="text-primary mt-0.5 text-sm font-medium tabular-nums">
                        {p.classOverrides[c] !== undefined ? (
                          formatLeverage(p.classOverrides[c]!)
                        ) : (
                          <span className="text-muted font-normal">база</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <dl className="border-border grid grid-cols-2 gap-3 border-t pt-3">
                  <div>
                    <dt className="text-muted text-xs">Наценка на спред</dt>
                    <dd className="text-primary mt-0.5 text-sm font-medium tabular-nums">
                      {p.markupBps > 0 ? (
                        <>
                          {p.markupBps} б.п. <span className="text-muted font-normal">· {bpsText(p.markupBps)}</span>
                        </>
                      ) : (
                        <span className="text-muted">нет</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted text-xs">Комиссия</dt>
                    <dd className="text-primary mt-0.5 text-sm font-medium tabular-nums">
                      {p.commissionBps > 0 ? (
                        <>
                          {p.commissionBps} б.п. <span className="text-muted font-normal">· {bpsText(p.commissionBps)}</span>
                        </>
                      ) : (
                        <span className="text-muted">нет</span>
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="text-secondary text-xs" data-min-balance>
                  Переход с баланса:{' '}
                  <span className="text-primary font-medium tabular-nums">
                    {p.isDefault || p.minBalanceMinor === 0 ? 'с регистрации' : `от ${formatUsdt(p.minBalanceMinor)} USDT`}
                  </span>
                </p>
                <p className="text-secondary text-xs">
                  Инструменты: {p.instruments ?? <span className="text-muted">не указаны</span>}
                </p>
              </div>
            </Panel>
          );
        })}
      </section>

      {editing ? (
        <div id="edit">
          <PortfolioEditor
            key={editing.key}
            portfolioKey={editing.key}
            title={editing.title}
            baseLeverage={editing.baseLeverage}
            classOverrides={editing.classOverrides}
            clientCount={clientsOf(editing)}
            isDefault={editing.isDefault}
            markupBps={editing.markupBps}
            commissionBps={editing.commissionBps}
            minBalanceMinor={editing.minBalanceMinor}
            instruments={editing.instruments}
            description={editing.description}
          />
        </div>
      ) : null}

      <Panel title="Как определяется плечо клиента" description="Первое найденное правило побеждает.">
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            [
              'Индивидуальное плечо',
              'Выдаётся конкретному клиенту по заявке на вкладке «Плечо клиентов».',
            ],
            ['Плечо категории в портфеле', 'Например, криптовалюты 1:10 в Standard — для всех его клиентов.'],
            ['Базовое плечо портфеля', 'Если ни индивидуального плеча, ни плеча категории нет.'],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="bg-primary/[0.07] text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="text-primary block text-sm font-medium">{t}</span>
                <span className="text-secondary block text-[13px]">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
