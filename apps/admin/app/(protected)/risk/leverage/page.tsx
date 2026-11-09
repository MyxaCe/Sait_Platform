import Link from 'next/link';
import {
  Breadcrumbs,
  Button,
  Callout,
  DataTable,
  DescriptionList,
  EmptyState,
  Input,
  Panel,
  ToneBadge,
  type DataTableColumn,
} from '@broker/ui';
import { resolveLeverage, TERMINAL_INSTRUMENT_CLASS } from '@broker/money';
import { listPortfolios, getClientLeverage, getDefaultPortfolioKey } from '@/lib/leverage/queries';
import { listClients, type ClientRow } from '@/lib/clients/queries';
import { getOperatorSession } from '@/lib/auth/current';
import { formatLeverage } from '@/lib/leverage/resolve';
import { fmtDateTime } from '@/lib/ui/format';
import { RiskHeader } from '../_components/RiskHeader';
import { getClientBrief, listClientLeverageSettings, type ClientLeverageRow } from '../_components/queries';
import { ClientLeveragePanel } from './_components/ClientLeveragePanel';

/**
 * Риск/плечо — плечо клиентов `/risk/leverage` (WEB-44/46, Р-446, §3.8).
 *
 * Индивидуальное плечо (override) конкретному клиенту ПО ЗАЯВКЕ (кто/когда/
 * основание/№ заявки), journaled, приоритет над портфелем и классом (Р-446).
 * Плюс назначение клиенту портфеля (атрибут клиента, WEB-44). Клиента находят
 * по имени/email/id (`?q=`) или выбирают из списка клиентов с явными
 * настройками; выбранный — `?userId=`.
 *
 * Роль-гейт (§3.8): просмотр — operator+admin; назначение/выдача/снятие —
 * только admin (формы лишь для admin, fail-closed). Journaled в
 * `admin_action_journal` — override «не тихо в базе» (Р-446).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeverageOverridePage({
  searchParams,
}: {
  searchParams: { userId?: string; q?: string };
}) {
  const userId = (searchParams.userId ?? '').trim();
  const q = (searchParams.q ?? '').trim();
  const validId = UUID.test(userId);
  const [portfolios, operator, defaultKey, settings] = await Promise.all([
    listPortfolios(),
    getOperatorSession(),
    getDefaultPortfolioKey(),
    listClientLeverageSettings(),
  ]);
  const isAdmin = operator?.role === 'admin';
  const titleOf = (key: string) => portfolios.find((p) => p.key === key)?.title ?? key;

  const [view, brief, found] = await Promise.all([
    validId ? getClientLeverage(userId) : Promise.resolve(null),
    validId ? getClientBrief(userId) : Promise.resolve(null),
    q ? listClients({ search: q }) : Promise.resolve([] as ClientRow[]),
  ]);

  const assignedKey = view?.portfolioKey ?? defaultKey ?? portfolios[0]?.key ?? null;
  const portfolio = portfolios.find((p) => p.key === assignedKey) ?? null;
  const effective = portfolio
    ? resolveLeverage({
        portfolio,
        clientOverride: view?.override ?? null,
        instrumentClass: TERMINAL_INSTRUMENT_CLASS,
      })
    : null;
  const SOURCE: Record<string, string> = {
    'client-override': 'индивидуальное плечо клиента',
    'class-override': `планка класса «${TERMINAL_INSTRUMENT_CLASS}» в портфеле`,
    portfolio: 'базовое плечо портфеля',
  };

  const settingsColumns: DataTableColumn<ClientLeverageRow>[] = [
    {
      key: 'client',
      header: 'Клиент',
      cell: (r) => (
        <Link href={`/risk/leverage?userId=${r.userId}`} className="group block min-w-0">
          <span className="text-primary group-hover:text-accent block truncate font-medium">
            {r.fullName}
          </span>
          <span className="text-muted block truncate text-xs">{r.email}</span>
        </Link>
      ),
    },
    { key: 'portfolio', header: 'Портфель', width: '7rem', cell: (r) => titleOf(r.portfolioKey) },
    {
      key: 'override',
      header: 'По заявке',
      width: '6.5rem',
      cell: (r) =>
        r.overrideLeverage ? (
          <ToneBadge tone="warning">{formatLeverage(r.overrideLeverage)}</ToneBadge>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'terminal',
      header: 'В терминале',
      numeric: true,
      width: '7rem',
      cell: (r) => {
        const p = portfolios.find((x) => x.key === r.portfolioKey);
        if (!p) return '—';
        const res = resolveLeverage({
          portfolio: p,
          clientOverride: r.overrideLeverage
            ? { leverage: r.overrideLeverage, reason: '', ticket: '' }
            : null,
          instrumentClass: TERMINAL_INSTRUMENT_CLASS,
        });
        return <span className="font-medium">{formatLeverage(res.leverage)}</span>;
      },
    },
    {
      key: 'go',
      header: <span className="sr-only">Действие</span>,
      width: '5.5rem',
      align: 'right',
      cell: (r) => (
        <Link
          href={`/risk/leverage?userId=${r.userId}`}
          className="text-accent text-[13px] font-medium hover:underline"
        >
          {isAdmin ? 'Изменить' : 'Открыть'}
        </Link>
      ),
    },
  ];

  const foundColumns: DataTableColumn<ClientRow>[] = [
    {
      key: 'client',
      header: 'Клиент',
      cell: (c) => (
        <Link href={`/risk/leverage?userId=${c.userId}`} className="group block min-w-0">
          <span className="text-primary group-hover:text-accent block truncate font-medium">
            {c.fullName}
          </span>
          <span className="text-muted block truncate text-xs">{c.email}</span>
        </Link>
      ),
    },
    {
      key: 'portfolio',
      header: 'Портфель',
      width: '9rem',
      cell: (c) => {
        const s = settings.find((x) => x.userId === c.userId);
        return s ? titleOf(s.portfolioKey) : <span className="text-muted">по умолчанию</span>;
      },
    },
    {
      key: 'go',
      header: <span className="sr-only">Действие</span>,
      width: '5.5rem',
      align: 'right',
      cell: (c) => (
        <Link
          href={`/risk/leverage?userId=${c.userId}`}
          className="text-accent text-[13px] font-medium hover:underline"
        >
          Выбрать
        </Link>
      ),
    },
  ];

  const search = (
    <form method="get" role="search" className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-secondary text-xs font-medium">Найти клиента</span>
        <Input
          name="q"
          type="search"
          controlSize="compact"
          defaultValue={q}
          placeholder="Имя, email или id клиента"
          autoComplete="off"
        />
      </label>
      <Button type="submit" size="compact" variant="secondary">
        Найти
      </Button>
      {q ? (
        <Link href="/risk/leverage" className="text-secondary hover:text-primary inline-flex h-9 items-center px-2 text-sm">
          Сбросить
        </Link>
      ) : null}
    </form>
  );

  const selectedPanel = validId && brief ? (
    <div className="space-y-5">
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            {brief.fullName}
            {view?.override ? (
              <ToneBadge tone="warning">Индивидуальное плечо</ToneBadge>
            ) : null}
          </span>
        }
        description={brief.email}
        actions={
          <Link
            href={`/clients/${userId}?tab=trading`}
            className="text-accent text-[13px] font-medium hover:underline"
          >
            Карточка клиента →
          </Link>
        }
      >
        <div className="space-y-4">
          <div className="border-border bg-sunken/60 flex flex-wrap items-baseline justify-between gap-3 rounded-md border px-4 py-3">
            <div>
              <p className="text-muted text-xs">Действует в терминале</p>
              <p className="text-primary text-2xl font-semibold tabular-nums tracking-tight">
                {effective ? formatLeverage(effective.leverage) : '—'}
              </p>
            </div>
            <p className="text-secondary max-w-xs text-right text-xs">
              {effective ? `Источник: ${SOURCE[effective.source]}.` : 'Портфель не задан.'} Одно
              плечо на счёт — терминал торгует только криптопарами.
            </p>
          </div>
          <DescriptionList
            columns={3}
            items={[
              {
                term: 'Портфель',
                value: portfolio ? portfolio.title : '—',
                hint: view ? 'назначен явно' : 'по умолчанию для новых клиентов',
              },
              {
                term: 'Плечо портфеля',
                value: portfolio ? formatLeverage(portfolio.baseLeverage) : '—',
                numeric: true,
              },
              {
                term: 'Планка класса crypto',
                value:
                  portfolio && portfolio.classOverrides[TERMINAL_INSTRUMENT_CLASS]
                    ? formatLeverage(portfolio.classOverrides[TERMINAL_INSTRUMENT_CLASS]!)
                    : 'нет',
                numeric: true,
              },
            ]}
          />
          {view?.override ? (
            <Callout tone="warning" title={`Индивидуальное плечо ${formatLeverage(view.override.leverage)} — перекрывает портфель`}>
              Заявка {view.override.ticket} · {view.override.reason}
              {view.override.byName ? ` · выдал ${view.override.byName}` : ''} ·{' '}
              {fmtDateTime(view.override.at)}
            </Callout>
          ) : null}
        </div>
      </Panel>

      {isAdmin ? (
        <ClientLeveragePanel
          key={userId}
          userId={userId}
          portfolios={portfolios.map((p) => ({
            key: p.key,
            title: p.title,
            baseLeverage: p.baseLeverage,
            cryptoLeverage: p.classOverrides[TERMINAL_INSTRUMENT_CLASS] ?? null,
          }))}
          assignedKey={assignedKey}
          override={view?.override ? { leverage: view.override.leverage, ticket: view.override.ticket } : null}
        />
      ) : null}
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <RiskHeader active="leverage" canEdit={isAdmin} />

      {selectedPanel ? (
        <Breadcrumbs
          linkComponent={Link}
          items={[{ label: 'Плечо клиентов', href: '/risk/leverage' }, { label: brief!.fullName }]}
        />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel
            title={q ? 'Результаты поиска' : 'Клиенты с явными настройками плеча'}
            count={q ? found.length : settings.length}
            description={
              q
                ? 'Выберите клиента, чтобы увидеть и изменить его плечо.'
                : 'Назначен портфель или выдано индивидуальное плечо. Остальные — в портфеле по умолчанию.'
            }
            flush
          >
            <div className="border-border border-b px-4 py-3">{search}</div>
            {q ? (
              <DataTable
                bare
                aria-label="Найденные клиенты"
                columns={foundColumns}
                rows={found.slice(0, 20)}
                rowKey={(c) => c.userId}
                selectedKey={validId ? userId : undefined}
                empty={
                  <EmptyState
                    size="compact"
                    title="Никого не нашли"
                    description="Проверьте написание имени или email."
                  />
                }
              />
            ) : (
              <DataTable
                bare
                aria-label="Клиенты с явными настройками плеча"
                columns={settingsColumns}
                rows={settings}
                rowKey={(r) => r.userId}
                selectedKey={validId ? userId : undefined}
                rowTone={(r) => (r.overrideLeverage ? 'warning' : undefined)}
                empty={
                  <EmptyState
                    size="compact"
                    title="Все клиенты в портфеле по умолчанию"
                    description="Найдите клиента выше, чтобы назначить портфель или индивидуальное плечо."
                  />
                }
              />
            )}
          </Panel>
        </div>

        <div className="min-w-0 self-start">
          {selectedPanel ??
            (userId ? (
              <Callout tone="warning" title="Клиент не найден">
                Проверьте ссылку или найдите клиента по имени.
              </Callout>
            ) : (
              <Panel>
                <EmptyState
                  size="compact"
                  title="Клиент не выбран"
                  description="Выберите клиента в списке или найдите по имени — здесь появится его плечо и формы изменения."
                />
              </Panel>
            ))}
        </div>
      </div>
    </div>
  );
}
