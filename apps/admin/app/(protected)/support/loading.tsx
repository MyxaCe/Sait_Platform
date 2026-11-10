import { DataTable, KpiTile, PageHeader, Panel } from '@broker/ui';

/** Загрузка очереди поддержки: тот же каркас, плитки-заглушки и строки-скелеты. */
const COLS = ['Обращение', 'Канал', 'Статус', 'Назначен', 'Ждёт / SLA', ''].map((h, i) => ({ key: String(i), header: h, cell: () => null }));

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Поддержка" description="Обращения клиентов из чата кабинета, почты и формы сайта." meta="Загрузка…" />
      <section aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['Ждут ответа', 'Просрочен SLA', 'Не назначены', 'Решено за 24 ч'].map((l) => (
          <KpiTile key={l} label={l} placeholder placeholderHint="загрузка" />
        ))}
      </section>
      <Panel flush>
        <DataTable bare aria-label="Обращения" columns={COLS} rows={[]} rowKey={() => ''} loadingRows={8} />
      </Panel>
    </div>
  );
}
