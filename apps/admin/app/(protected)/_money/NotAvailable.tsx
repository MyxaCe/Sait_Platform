import Link from 'next/link';
import { EmptyState, Panel } from '@broker/ui';

/**
 * Отказ по роли для разделов «Деньги» и «Настройки платформы» (их `notFound()`
 * отдаёт 404). Внутри каркаса, по-русски и без подробностей: не подтверждает,
 * что раздел существует, и не рисует ничего из его содержимого (fail-closed).
 */
export function NotAvailable() {
  return (
    <Panel>
      <EmptyState
        title="Страница недоступна"
        description="Такой страницы нет или она не входит в права вашей роли. Если доступ нужен по работе — обратитесь к администратору платформы."
        action={
          <Link href="/" className="text-accent text-[13px] font-medium hover:underline">
            На дашборд →
          </Link>
        }
      />
    </Panel>
  );
}
