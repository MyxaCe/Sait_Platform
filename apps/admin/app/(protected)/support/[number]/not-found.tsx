import Link from 'next/link';
import { EmptyState } from '@broker/ui';

export default function NotFound() {
  return (
    <EmptyState
      title="Обращение не найдено"
      description="Номера нет, или это обращение вам не назначено."
      action={
        <Link href="/support" className="text-accent text-sm font-medium hover:underline">
          К очереди
        </Link>
      }
    />
  );
}
