import Link from 'next/link';
import { Callout, PageHeader, Tabs } from '@broker/ui';

/**
 * Общая шапка раздела «Риск и плечо»: заголовок, вкладки-ссылки между двумя
 * экранами раздела и главное предупреждение — изменения уходят в терминал
 * сразу и действуют только на новые позиции. Роль-гейт не трогает: что
 * показывать для роли, решают сами страницы.
 */
export function RiskHeader({
  active,
  canEdit,
}: {
  active: 'leverage' | 'portfolios';
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Риск и плечо"
        description="Плечо — свойство портфеля. Клиенту назначают портфель; по заявке — индивидуальное плечо, которое перекрывает портфель."
      />
      <Tabs
        linkComponent={Link}
        active={active}
        items={[
          { key: 'leverage', label: 'Плечо клиентов', href: '/risk/leverage' },
          { key: 'portfolios', label: 'Портфели', href: '/risk/portfolios' },
        ]}
      />
      {canEdit ? (
        <Callout tone="info" title="Изменение сразу уходит в торговый терминал">
          Новое плечо действует на новые позиции; открытые позиции сохраняют плечо, с которым были
          открыты. Если терминал не ответил, изменение не применяется нигде — ни здесь, ни в
          терминале.
        </Callout>
      ) : (
        <Callout tone="neutral" title="Только просмотр">
          Назначение портфелей и плеча — действие администратора. Изменения действуют на новые
          позиции; открытые сохраняют своё плечо.
        </Callout>
      )}
    </div>
  );
}
