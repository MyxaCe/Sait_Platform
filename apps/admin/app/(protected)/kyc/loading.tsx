import { DataTable, KpiTile, PageHeader, Panel } from '@broker/ui';

/** Загрузка очереди KYC: тот же каркас, плитки-заглушки и строки-скелеты. */
const COLS = ['Клиент', 'Документы', 'В очереди', 'Статус', ''].map((h, i) => ({
  key: String(i),
  header: h,
  cell: () => null,
}));

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Верификация"
        description="Клиенты, ждущие решения по документам KYC. Старейшие сверху."
        meta="Загрузка…"
      />
      <section aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['Ждут решения', 'Просрочено', 'Старейшая заявка', 'Ждут клиента'].map((l) => (
          <KpiTile key={l} label={l} placeholder placeholderHint="загрузка" />
        ))}
      </section>
      <Panel title="Очередь верификации" flush>
        <DataTable bare aria-label="Очередь верификации" columns={COLS} rows={[]} rowKey={() => ''} loadingRows={6} />
      </Panel>
    </div>
  );
}
