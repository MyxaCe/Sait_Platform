import Link from 'next/link';
import { EmptyState, Panel } from '@broker/ui';

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
