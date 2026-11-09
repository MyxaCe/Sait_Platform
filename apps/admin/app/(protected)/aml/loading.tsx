import { DataTable, KpiTile, PageHeader, Panel } from '@broker/ui';

/** Загрузка рабочего списка AML: тот же каркас, строки-скелеты. */
const COLS = ['Клиент', 'AML', 'Последняя сверка', 'Списки', 'Доступ', ''].map((h, i) => ({
  key: String(i),
  header: h,
  cell: () => null,
}));

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader title="AML-скрининг" meta="Загрузка…" />
      <section aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['Эскалации', 'Не сверялись', 'Чисто', 'Давность сверки'].map((l) => (
          <KpiTile key={l} label={l} placeholder placeholderHint="загрузка" />
        ))}
      </section>
      <Panel title="Рабочий список" flush>
        <DataTable bare aria-label="AML: рабочий список" columns={COLS} rows={[]} rowKey={() => ''} loadingRows={8} />
      </Panel>
    </div>
  );
}
