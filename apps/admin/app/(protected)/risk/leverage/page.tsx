import Link from 'next/link';
import { listPortfolios, getClientLeverage, getDefaultPortfolioKey } from '@/lib/leverage/queries';
import { getOperatorSession } from '@/lib/auth/current';
import { formatLeverage } from '@/lib/leverage/resolve';
import { ClientLeveragePanel } from './_components/ClientLeveragePanel';

/**
 * Риск/плечо — override `/risk/leverage` (WEB-44/46, Р-446, §3.8).
 *
 * Override плеча конкретному клиенту ПО ЗАЯВКЕ (кто/когда/основание/№ заявки),
 * journaled, приоритет над портфелем и классом (Р-446). Плюс назначение
 * клиенту портфеля (атрибут клиента, WEB-44). Клиент адресуется по его UUID
 * (`userId`) — экран не трогает реестр клиентов (анти-коллизия).
 *
 * Роль-гейт (§3.8): просмотр — operator+admin; назначение/выдача/снятие —
 * только admin (формы лишь для admin, fail-closed). Journaled в
 * `admin_action_journal` — override «не тихо в базе» (Р-446).
 */
export const dynamic = 'force-dynamic';

export default async function LeverageOverridePage({
  searchParams,
}: {
  searchParams: { userId?: string };
}) {
  const userId = (searchParams.userId ?? '').trim();
  const [portfolios, operator, defaultKey] = await Promise.all([
    listPortfolios(),
    getOperatorSession(),
    getDefaultPortfolioKey(),
  ]);
  const isAdmin = operator?.role === 'admin';

  const view = userId ? await getClientLeverage(userId) : null;
  const assignedKey = view?.portfolioKey ?? defaultKey ?? portfolios[0]?.key ?? null;
  const portfolio = portfolios.find((p) => p.key === assignedKey) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Override плеча клиенту</h1>
        <p className="text-sm text-secondary">
          Override выдаётся <span className="text-primary">по заявке</span> и имеет приоритет над
          портфелем и планкой класса (Р-446). Каждое действие пишется в журнал: кто, когда,
          основание, № заявки.
        </p>
        <p className="rounded border border-border bg-elevated px-3 py-2 text-xs text-secondary">
          Глобальные плечи портфелей — на экране{' '}
          <Link href="/risk/portfolios" className="text-accent hover:underline">
            Портфели плеча
          </Link>
          .
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex-1 space-y-1">
          <span className="block text-sm text-secondary">UUID клиента</span>
          <input
            name="userId"
            defaultValue={userId}
            className="w-full rounded border border-border bg-base px-3 py-2 text-sm tabular-nums text-primary outline-none focus:border-accent"
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-border bg-elevated px-4 py-2 text-sm text-primary hover:border-accent"
        >
          Найти
        </button>
      </form>

      {!userId ? (
        <p className="rounded border border-border bg-elevated px-3 py-2 text-sm text-secondary">
          Укажите UUID клиента, чтобы увидеть его плечо и управлять override.
        </p>
      ) : (
        <section className="space-y-4">
          <dl className="grid grid-cols-1 gap-2 rounded border border-border bg-elevated px-4 py-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-secondary">Клиент</dt>
              <dd className="tabular-nums text-primary">{userId}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-secondary">Портфель</dt>
              <dd className="text-primary">
                {portfolio ? portfolio.title : '—'}
                {view?.portfolioKey ? '' : ' (по умолчанию, явно не назначен)'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-secondary">Плечо портфеля</dt>
              <dd className="tabular-nums text-primary">
                {portfolio ? formatLeverage(portfolio.baseLeverage) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-secondary">Действующее плечо</dt>
              <dd className="tabular-nums text-primary">
                {view?.override
                  ? `${formatLeverage(view.override.leverage)} (override)`
                  : portfolio
                    ? `${formatLeverage(portfolio.baseLeverage)} (портфель)`
                    : '—'}
              </dd>
            </div>
          </dl>

          {view?.override ? (
            <div className="rounded border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
              <p className="font-medium text-primary">
                Действует override {formatLeverage(view.override.leverage)} — приоритет над портфелем.
              </p>
              <p className="text-secondary">
                Заявка {view.override.ticket} · основание: {view.override.reason}
                {view.override.byName ? ` · выдал ${view.override.byName}` : ''} ·{' '}
                {new Date(view.override.at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
          ) : null}

          {isAdmin ? (
            <ClientLeveragePanel
              userId={userId}
              portfolios={portfolios.map((p) => ({ key: p.key, title: p.title, baseLeverage: p.baseLeverage }))}
              assignedKey={assignedKey}
              hasOverride={Boolean(view?.override)}
            />
          ) : (
            <p className="rounded border border-border bg-elevated px-3 py-2 text-sm text-secondary">
              Просмотр. Назначение портфеля и выдача/снятие override — действие администратора.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
