import { PageSkeleton } from '@/components/shell/PageSkeleton';

/** Скелетон раздела на время серверного рендера (концепция §6.1). */
export default function Loading() {
  return <PageSkeleton variant="card" />;
}
