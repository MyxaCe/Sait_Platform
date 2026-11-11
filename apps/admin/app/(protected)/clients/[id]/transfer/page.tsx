import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs, Callout, DescriptionList, PageHeader, Panel } from '@broker/ui';
import {
  CONSENT_TEXT_RU,
  CONSENT_TEXT_VERSION,
  checkDirection,
  getClientTransfers,
  getGroupPlatform,
  listGroupPlatforms,
  listTicketsForTransfer,
  LIVE_STATUSES,
  MANAGER_DAILY_TRANSFER_LIMIT,
} from '@broker/transfer';
import { getOperatorSession } from '@/lib/auth/current';
import { getClientManager } from '@/lib/managers/queries';
import { getPool } from '@/lib/db';
import { BLOCKER_TEXT, HINT_TEXT, transferStatus } from '@/lib/transfer/labels';
import { selfSlug, signingKey } from '@/lib/transfer/runtime';
import { TransferForm, type TargetOption, type TicketOption } from '../../_components/transfer/TransferForm';

/**
 * «Перевести клиента на другую платформу группы» — отдельная страница,
 * открывается отдельной кнопкой карточки (барьер «случайного перевода»).
 * Провести может только закреплённый менеджер клиента; остальные видят
 * объяснение. Admin перевод не проводит — он контролирует постфактум.
 */
export const dynamic = 'force-dynamic';

export default async function TransferClientPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const db = getPool();
  const operator = await getOperatorSession();
  const u = await db.query(
    `SELECT u.id, u.full_name, u.email, u.country, v.state AS kyc FROM users u
       LEFT JOIN client_verification v ON v.user_id = u.id WHERE u.id = $1`,
    [params.id],
  );
  const user = u.rows[0];
  if (!user) notFound();
  const slug = selfSlug();
  const [manager, platforms, self, tickets, existing] = await Promise.all([
    getClientManager(params.id),
    listGroupPlatforms(db),
    slug ? getGroupPlatform(db, slug) : Promise.resolve(null),
    listTicketsForTransfer(db, params.id),
    getClientTransfers(db, params.id),
  ]);
  const isManager = manager !== null && manager.managerId === operator?.operatorId;
  const live = existing.find((t) => (LIVE_STATUSES as readonly string[]).includes(t.status));

  const targets: TargetOption[] = platforms
    .filter((p) => p.slug !== slug)
    .map((p) => {
      const c = checkDirection({
        selfSlug: slug ?? '',
        source: self,
        target: p,
        clientCountry: (user.country as string | null) ?? null,
        sourceKycState: String(user.kyc ?? 'unverified'),
      });
      return {
        slug: p.slug,
        name: p.name,
        legalEntity: p.legalEntity,
        euLicense: p.euLicense,
        maxRetailLeverage: p.maxRetailLeverage,
        blockers: c.blockers,
        blockerText: c.blockers.map((b) => BLOCKER_TEXT[b] ?? b),
        hintText: c.hints.map((h) => HINT_TEXT[h] ?? h),
      };
    });
  const ticketOptions: TicketOption[] = tickets.eligible.map((t) => ({
    ticketId: t.ticketId,
    number: t.number,
    subject: t.subject,
    createdAt: t.createdAt,
    originChannel: t.originChannel,
    firstExcerpt: t.first.excerpt,
    usedByTransfer: t.usedByTransfer,
    clientMessages: t.clientMessages.map((m) => ({ id: m.id, createdAt: m.createdAt, excerpt: m.excerpt })),
  }));

  const name = String(user.full_name);
  return (
    <div className="space-y-5">
      <Breadcrumbs
        linkComponent={Link}
        items={[
          { label: 'Клиенты', href: '/clients' },
          { label: name, href: `/clients/${params.id}` },
          { label: 'Перевод на другую платформу группы' },
        ]}
      />
      <PageHeader
        title="Перевести клиента на другую платформу группы"
        description="Только по заявлению клиента в техподдержку. Перевод проводит менеджер клиента; администратор видит каждый перевод и может его вернуть."
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {!slug ? (
            <Callout tone="negative" title="Своя платформа не определена">
              SITE_SLUG процесса админки не задан — перевод невозможен.
            </Callout>
          ) : !isManager ? (
            <Callout tone="warning" title="Перевод проводит закреплённый менеджер клиента">
              {manager
                ? `Менеджер клиента — ${manager.managerName}. ${operator?.role === 'admin' ? 'Администратор перевод не проводит: он видит все переводы в разделе «Переводы клиентов» и может вернуть любой.' : ''}`
                : 'У клиента нет менеджера. Закрепить менеджера может администратор в карточке клиента.'}
            </Callout>
          ) : live ? (
            <Callout tone="info" title={`У клиента уже есть перевод ${live.number}`}>
              Статус: {transferStatus(live.status).label}.{' '}
              <Link href={`/clients/transfers/${live.id}`} className="text-accent hover:underline">
                Открыть перевод →
              </Link>
            </Callout>
          ) : (
            <Panel title="Перевод" description="Все четыре шага обязательны. Сервер повторно проверит тикет, согласие и направление.">
              <TransferForm
                userId={params.id}
                clientName={name}
                targets={targets}
                tickets={ticketOptions}
                rejected={tickets.rejected.map((r) => ({ number: r.number, subject: r.subject, reason: r.reason }))}
                consentText={CONSENT_TEXT_RU}
                consentVersion={CONSENT_TEXT_VERSION}
              />
            </Panel>
          )}
        </div>
        <aside className="min-w-0 space-y-5">
          <Panel title="Клиент">
            <DescriptionList
              columns={1}
              items={[
                { term: 'ФИО', value: name },
                { term: 'Email', value: String(user.email) },
                { term: 'Страна', value: (user.country as string | null) ?? 'не указана' },
                { term: 'KYC здесь', value: String(user.kyc ?? 'unverified') === 'verified' ? 'подтверждён' : 'не подтверждён' },
                { term: 'Менеджер', value: manager ? manager.managerName : 'не закреплён' },
              ]}
            />
          </Panel>
          <Panel title="Что уйдёт в платформу-цель">
            <ul className="text-secondary list-disc space-y-1.5 pl-4 text-[13px]">
              <li>ФИО, email, страна, язык; статус и дата KYC здесь.</li>
              <li>Хеш заявления (тикета) и сообщения-согласия, версия текста согласия. Сам текст переписки не передаётся.</li>
              <li>Без балансов и без документов KYC: в цели клиент сам регистрируется и проходит KYC заново.</li>
              <li>Пакет подписан ключом этой платформы{signingKey() ? '' : ' — ключ НЕ задан, доставка будет ждать'}.</li>
            </ul>
          </Panel>
          <Panel title="Деньги клиента">
            <p className="text-secondary text-[13px]">
              Внутреннего переноса средств нет. Клиент выводит средства отсюда обычной заявкой на вывод и пополняет счёт на
              новой платформе сам. После его регистрации в цели счёт здесь можно закрыть (заморозить) — в разделе перевода.
            </p>
          </Panel>
          <Panel title="Правила">
            <ul className="text-secondary list-disc space-y-1.5 pl-4 text-[13px]">
              <li>Предлагать перевод клиенту нельзя (рассылки, шаблоны, звонки) — только его заявление.</li>
              <li>Не больше {MANAGER_DAILY_TRANSFER_LIMIT} переводов за сутки у одного менеджера.</li>
              <li>Возвращённый администратором перевод учитывается в карточке менеджера.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
