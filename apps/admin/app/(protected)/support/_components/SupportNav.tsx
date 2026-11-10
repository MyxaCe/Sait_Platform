import Link from 'next/link';
import { Tabs } from '@broker/ui';

/** Подразделы «Поддержки»: очередь для всех; шаблоны и настройки — только admin (недоступное не отрисовано). */
export function SupportNav({ active, isAdmin, awaiting }: { active: 'queue' | 'templates' | 'settings'; isAdmin: boolean; awaiting?: number }) {
  if (!isAdmin) return null;
  return (
    <Tabs
      linkComponent={Link}
      active={active}
      aria-label="Разделы поддержки"
      items={[
        { key: 'queue', label: 'Очередь', href: '/support', count: awaiting, countTone: awaiting ? 'warning' : 'default' },
        { key: 'templates', label: 'Шаблоны ответов', href: '/support/templates' },
        { key: 'settings', label: 'Настройки', href: '/support/settings' },
      ]}
    />
  );
}
