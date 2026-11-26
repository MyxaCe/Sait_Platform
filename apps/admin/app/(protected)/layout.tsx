import { redirect } from 'next/navigation';
import { getOperatorSession } from '@/lib/auth/current';
import { isOperatorEnrolled } from '@/lib/auth/operator-totp';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { TopBar } from '@/components/shell/TopBar';
import { NavRail } from '@/components/shell/NavRail';
import { navForRole } from '@/components/shell/nav-registry';
import { enrollmentGate } from '@/lib/auth/enrollment-gate';
import { ServiceUnavailable } from '@/components/shell/ServiceUnavailable';
import { supportAttentionForSession } from '@/lib/support/attention';
import { adminBrand } from '@/lib/brand';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  const gate = await enrollmentGate(operator.operatorId, isOperatorEnrolled);
  if (gate === 'unavailable') return <ServiceUnavailable />;
  if (gate === 'enroll') redirect('/enroll');

  const navItems = navForRole(operator.role);
  const supportAttention = navItems.some((i) => i.key === 'support') ? await supportAttentionForSession() : null;

  return (
    <div className="flex min-h-svh">
      <NavRail items={navItems} supportAttention={supportAttention} brand={adminBrand()} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar operator={operator} />
        <main className="flex-1 px-6 py-6 xl:px-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
