import { PageSkeleton } from '@/components/shell/PageSkeleton';

/** Скелетон раздела «Акции и партнёры» на время серверного рендера. */
export default function Loading() {
  return <PageSkeleton variant="list" />;
}
