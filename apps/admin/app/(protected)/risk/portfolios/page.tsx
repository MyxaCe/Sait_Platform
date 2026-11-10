import Link from 'next/link';
import { Panel, ToneBadge, cn } from '@broker/ui';
import { resolveLeverage, TERMINAL_INSTRUMENT_CLASS } from '@broker/money';
import { listPortfolios } from '@/lib/leverage/queries';
import { getOperatorSession } from '@/lib/auth/current';
import { formatLeverage } from '@/lib/leverage/resolve';
import { RiskHeader } from '../_components/RiskHeader';
import { countClientsInDefaultImplicitly } from '../_components/queries';
import { PortfolioEditor } from './_components/PortfolioEditor';
import { bpsText } from '@/lib/promo/labels';

/**
 * Риск/плечо — портфели `/risk/portfolios` (WEB-47/45, Р-446, §3.9).
 *
 * Глобальная смена плеча портфеля (действует на всех клиентов портфеля) и
 * планка класса внутри портфеля (крипта — Р-446). Главное число карточки —
 * плечо, которое реально уходит в терминал (итог закона для класса crypto):
 * у Standard база 1:20, но торгует он 1:10 — это видно сразу.
 *
 * Роль-гейт (§3.9): просмотр — operator+admin (гейт layout/middleware);
 * изменение — только admin (формы рендерятся лишь для admin, fail-closed).
 * Чтение НЕ журналируем; изменения journaled в `admin_action_journal`.
 */
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
  // Клиенты без явной строки сидят в портфеле по умолчанию.
  const clientsOf = (p: { clientCount: number; isDefault: boolean }) =>
    p.clientCount + (p.isDefault ? implicit : 0);
  const isAdmin = operator?.role === 'admin';
  const editing = isAdmin ? portfolios.find((p) => p.key === searchParams.edit) : undefined;

  return (
    <div className="space-y-6">
      <RiskHeader active="portfolios" canEdit={isAdmin} />

      <section aria-label="Портфели плеча" className="grid gap-5 lg:grid-cols-3">
        {portfolios.map((p) => {
          const terminal = resolveLeverage({
            portfolio: p,
            clientOverride: null,
            instrumentClass: TERMINAL_INSTRUMENT_CLASS,
          });
          const crypto = p.classOverrides[TERMINAL_INSTRUMENT_CLASS];
          const otherClasses = Object.entries(p.classOverrides).filter(
            ([cls]) => cls !== TERMINAL_INSTRUMENT_CLASS,
          );
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
                <div>
                  <p className="text-muted text-xs">Плечо в терминале</p>
                  <p className="text-primary text-2xl font-semibold tabular-nums tracking-tight">
                    {formatLeverage(terminal.leverage)}
                  </p>
                  <p className="text-muted text-xs">
                    {terminal.source === 'class-override'
                      ? 'по планке класса crypto'
                      : 'по базовому плечу портфеля'}
                  </p>
                </div>
                <dl className="border-border grid grid-cols-3 gap-3 border-t pt-3">
                  <div>
                    <dt className="text-muted text-xs">База</dt>
                    <dd className="text-primary mt-0.5 text-sm font-medium tabular-nums">
                      {formatLeverage(p.baseLeverage)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted text-xs">Планка crypto</dt>
                    <dd className="text-primary mt-0.5 text-sm font-medium tabular-nums">
                      {crypto ? formatLeverage(crypto) : <span className="text-muted">нет</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted text-xs">Клиентов</dt>
                    <dd className="text-primary mt-0.5 text-sm font-medium tabular-nums">
                      {clientsOf(p)}
                    </dd>
                  </div>
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
                <p className="text-secondary text-xs">
                  Инструменты: {p.instruments ?? <span className="text-muted">не указаны</span>}
                </p>
                {otherClasses.length > 0 ? (
                  <p className="text-secondary text-xs tabular-nums">
                    Другие классы:{' '}
                    {otherClasses.map(([cls, lev]) => `${cls} ${formatLeverage(lev)}`).join(' · ')}
                  </p>
                ) : null}
                {crypto ? (
                  <p className="text-muted text-xs">
                    Пока задана планка crypto, смена базы на торговлю не влияет: терминал торгует
                    только криптопарами.
                  </p>
                ) : null}
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
            cryptoLeverage={editing.classOverrides[TERMINAL_INSTRUMENT_CLASS] ?? null}
            clientCount={clientsOf(editing)}
            isDefault={editing.isDefault}
            markupBps={editing.markupBps}
            commissionBps={editing.commissionBps}
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
            ['Планка класса в портфеле', 'Например, crypto 1:10 в Standard — для всех его клиентов.'],
            ['Базовое плечо портфеля', 'Если ни индивидуального плеча, ни планки класса нет.'],
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
