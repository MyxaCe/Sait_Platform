import { requireSection } from '@/lib/auth/section-guard';

/** Роль-гейт раздела по матрице components/shell/sections.ts (поверх middleware). */
export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requireSection('settings');
  return <>{children}</>;
}
