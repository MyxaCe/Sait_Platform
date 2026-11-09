import { DataTable, PageHeader, Panel } from '@broker/ui';

/** Загрузка реестра: тот же каркас, что у страницы, строки-скелеты (концепция §6.1). */
const COLS = ['Клиент', 'KYC', 'AML', 'Доступ', 'Реальный счёт', 'Последний вход', ''].map((h, i) => ({
  key: String(i),
  header: h,
  cell: () => null,
}));

export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeader title="Клиенты" description="Реестр клиентов платформы: верификация, AML, доступ и реальный счёт." meta="Загрузка…" />
      <Panel flush>
        <DataTable bare aria-label="Реестр клиентов" columns={COLS} rows={[]} rowKey={() => ''} loadingRows={8} />
      </Panel>
    </div>
  );
}
