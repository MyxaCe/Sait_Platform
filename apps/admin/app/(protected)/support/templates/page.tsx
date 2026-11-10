import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DataTable, EmptyState, Mono, PageHeader, Panel, ToneBadge, type DataTableColumn } from '@broker/ui';
import { listTemplates, loadSupportSettings, supportAccess, type TemplateRow } from '@broker/support';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { getPool } from '@/lib/db';
import { saveTemplateAction } from '@/lib/support/actions';
import { supportActor } from '@/lib/support/runtime';
import { fmtDateTime } from '@/lib/ui/format';
import { TemplateForm } from '../_components/SettingsForms';
import { SupportNav } from '../_components/SupportNav';

/**
 * Шаблоны ответов (CRUD — только admin): операторы выбирают их в ответе,
 * переменные подставляются из обращения. Выключенный шаблон не виден в
 * списке оператора; удаления нет — история в журнале.
 */
export const dynamic = 'force-dynamic';

export default async function TemplatesPage({ searchParams }: { searchParams: { edit?: string } }) {
  const actor = await supportActor();
  if (!actor) redirect(LOGIN_PATH);
  if (!supportAccess.managesSettings(actor.role)) notFound();
  const db = getPool();
  const [rows, settings] = await Promise.all([listTemplates(db), loadSupportSettings(db)]);
  const editing = searchParams.edit ? rows.find((r) => r.id === searchParams.edit) ?? null : null;
  const catLabel = new Map(settings.categories.map((c) => [c.key, c.label.ru]));

  const columns: DataTableColumn<TemplateRow>[] = [
    {
      key: 'title',
      header: 'Шаблон',
      cell: (t) => (
        <span className="block min-w-0">
          <span className="text-primary block truncate font-medium">{t.title}</span>
          <span className="text-muted block truncate text-xs">{t.body.split('\n')[0]}</span>
        </span>
      ),
    },
    { key: 'key', header: 'Ключ', width: '10rem', cell: (t) => <Mono value={t.key} className="text-[12px]" /> },
    { key: 'loc', header: 'Язык', width: '4.5rem', cell: (t) => t.locale.toUpperCase() },
    { key: 'cat', header: 'Категория', width: '9rem', cell: (t) => (t.category ? catLabel.get(t.category) ?? t.category : <span className="text-muted">—</span>) },
    { key: 'state', header: 'Статус', width: '7rem', cell: (t) => (t.active ? <ToneBadge tone="positive">Активен</ToneBadge> : <ToneBadge tone="neutral">Выключен</ToneBadge>) },
    { key: 'upd', header: 'Изменён', numeric: true, width: '10rem', cell: (t) => <span className="text-secondary text-xs">{fmtDateTime(t.updatedAt)}</span> },
    {
      key: 'go',
      header: <span className="sr-only">Действие</span>,
      width: '6rem',
      align: 'right',
      cell: (t) =>
        editing?.id === t.id ? (
          <span className="text-secondary text-[13px]">Открыт</span>
        ) : (
          <Link href={`/support/templates?edit=${t.id}`} scroll={false} className="text-accent text-[13px] font-medium hover:underline">
            Изменить
          </Link>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Поддержка" description="Шаблоны ответов операторов. Переменные подставляются из обращения в момент выбора." meta={`Шаблонов: ${rows.length} · активных: ${rows.filter((r) => r.active).length}`} />
      <SupportNav active="templates" isAdmin />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel flush title="Шаблоны" count={rows.length}>
          <DataTable
            bare
            aria-label="Шаблоны ответов"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            selectedKey={editing?.id}
            empty={<EmptyState size="compact" title="Шаблонов пока нет" description="Создайте первый справа — операторы увидят его в ответе." />}
          />
        </Panel>
        <Panel
          title={editing ? 'Изменить шаблон' : 'Новый шаблон'}
          actions={
            editing ? (
              <Link href="/support/templates" className="text-accent text-[13px] font-medium hover:underline">
                + Новый
              </Link>
            ) : null
          }
        >
          <TemplateForm
            key={editing?.id ?? 'new'}
            action={saveTemplateAction}
            categories={settings.categories.map((c) => ({ key: c.key, label: c.label.ru }))}
            initial={
              editing
                ? { id: editing.id, key: editing.key, locale: editing.locale, title: editing.title, body: editing.body, category: editing.category ?? '', active: editing.active }
                : { id: null, key: '', locale: 'ru', title: '', body: 'Здравствуйте, {{client.firstName}}!\n\n\n\n{{operator.name}}', category: '', active: true }
            }
          />
        </Panel>
      </div>
    </div>
  );
}
