import { requireSection } from '@/lib/auth/section-guard';

export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requireSection('clients');
  return <>{children}</>;
}
