import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DescriptionList, PageHeader, Panel, ToneBadge } from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { listOperators } from '@/lib/operators/queries';
import { fmtDateTime } from '@/lib/ui/format';
import { CreateOperatorForm } from './_components/CreateOperatorForm';
import { ChangeRoleForm, DisableOperatorForm } from './_components/OperatorRowActions';
import { OperatorsTable } from './_components/OperatorsTable';
import { ROLES, ROLE_LABEL, ROLE_SCOPE } from './_components/roles';

/**
 * Операторы `/operators` (ADM-04, Р-394, Р-049; концепция §7.1 + боковая колонка).
 *
 * Провижининг: список операторов + завод нового + смена роли/отключение.
 * Роль-гейт admin only, fail-closed (Р-394): не-админ получает 404, экран ему
 * НЕ отрисован (а не «серый и кликабельный»). Авторитетный гейт — middleware +
 * layout; эта проверка — defence-in-depth и источник actorId для «нельзя над
 * собой».
 *
 * Справа — панель выбранного оператора (`?op=id`) или форма завода. Серверный
 * компонент: читает из базы напрямую, действия — через server actions.
 */
export const dynamic = 'force-dynamic';

export default async function OperatorsPage({
  searchParams,
}: {
  searchParams: { op?: string };
}) {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  // Fail-closed: экран операторов виден только админу (Р-394). Не disabled —
  // именно отсутствует (404), чтобы роль-гейт нельзя было обойти POST-ом в UI.
  if (operator.role !== 'admin') notFound();

  const all = await listOperators();
  // Служебные учётные записи (`system:*`) подписывают автоматические действия
  // (кабинет клиента, наблюдатель сети) — войти под ними нельзя. Показываем
  // их отдельно, чтобы не путать с людьми.
  const system = all.filter((o) => o.login.startsWith('system:'));
  const operators = all.filter((o) => !o.login.startsWith('system:'));
  const active = operators.filter((o) => !o.disabledAt);
  const withTotp = active.filter((o) => o.totpEnrolled).length;
  // Себя и отключённых не выбираем (над ними действий нет).
  const selected = operators.find(
    (o) => o.id === searchParams.op && o.id !== operator.operatorId && !o.disabledAt,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Операторы"
        description="Кто имеет доступ к центру управления и с какими правами. Вход — только по паролю и второму фактору; каждое изменение доступа пишется в журнал."
        meta={
          <span className="tabular-nums">
            Всего {operators.length} · активны {active.length} · с 2FA {withTotp} из {active.length}
          </span>
        }
        actions={
          selected ? (
            <Link
              href="/operators"
              className="border-border-strong text-primary hover:bg-primary/[0.04] inline-flex h-9 items-center rounded-md border px-3.5 text-sm"
            >
              Завести оператора
            </Link>
          ) : null
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel
            title="Доступ к центру управления"
            count={operators.length}
            description="Отключённые остаются в списке: на них ссылаются записи журнала."
            flush
          >
            <OperatorsTable
              operators={operators}
              currentOperatorId={operator.operatorId}
              selectedId={selected?.id}
            />
          </Panel>

          <Panel title="Роли" description="Что видит и может каждая роль. Недоступное роли не показывается вовсе.">
            <dl className="grid gap-4 sm:grid-cols-3">
              {ROLES.map((r) => (
                <div key={r} className="min-w-0">
                  <dt className="text-primary text-sm font-medium">{ROLE_LABEL[r]}</dt>
                  <dd className="text-secondary mt-0.5 text-[13px]">{ROLE_SCOPE[r]}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          {system.length > 0 ? (
            <Panel
              title="Служебные учётные записи"
              count={system.length}
              description="Ими подписаны автоматические записи журнала. Входа под ними нет."
            >
              <ul className="grid gap-3 sm:grid-cols-2">
                {system.map((s) => (
                  <li key={s.id} className="min-w-0">
                    <span className="text-primary block truncate text-[13px] font-medium">
                      {s.displayName}
                    </span>
                    <span className="text-muted flex items-center gap-2 text-xs">
                      <span className="font-mono">{s.login}</span>
                      <Link
                        href={`/journal?operatorId=${s.id}`}
                        className="text-accent font-medium hover:underline"
                      >
                        Записи →
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="min-w-0 space-y-5 self-start">
          {selected ? (
            <>
              <Panel
                title={selected.displayName}
                description={`Логин ${selected.login}`}
                actions={
                  <Link href="/operators" className="text-secondary hover:text-primary text-xs">
                    Закрыть
                  </Link>
                }
              >
                <div className="space-y-5">
                  <DescriptionList
                    columns={2}
                    items={[
                      { term: 'Роль', value: ROLE_LABEL[selected.role] },
                      {
                        term: '2FA',
                        value: selected.totpEnrolled ? (
                          <ToneBadge tone="positive">Включена</ToneBadge>
                        ) : (
                          <ToneBadge tone="warning">Не включена</ToneBadge>
                        ),
                      },
                      { term: 'Заведён', value: fmtDateTime(selected.createdAt), numeric: true },
                      {
                        term: 'Журнал',
                        value: (
                          <Link
                            href={`/journal?operatorId=${selected.id}`}
                            className="text-accent font-medium hover:underline"
                          >
                            Его действия →
                          </Link>
                        ),
                      },
                    ]}
                  />
                  <div className="border-border border-t pt-4">
                    <h3 className="text-primary mb-3 text-sm font-semibold">Сменить роль</h3>
                    <ChangeRoleForm
                      key={selected.id}
                      operatorId={selected.id}
                      login={selected.login}
                      role={selected.role}
                    />
                  </div>
                </div>
              </Panel>
              <Panel
                tone="danger"
                title="Опасная зона"
                description="Отключение закрывает вход немедленно."
              >
                <DisableOperatorForm
                  key={selected.id}
                  operatorId={selected.id}
                  login={selected.login}
                />
              </Panel>
            </>
          ) : (
            <Panel
              title="Завести оператора"
              description="Пароль хранится только как хеш; второй фактор оператор настроит при первом входе."
            >
              <CreateOperatorForm />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
