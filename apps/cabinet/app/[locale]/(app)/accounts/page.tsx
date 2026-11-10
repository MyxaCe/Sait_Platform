import { setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@/lib/auth/require';
import { loadAccountTerms } from '@/lib/promo';
import { AccountsScreen } from '@/features/promo/AccountsScreen';

/** «Условия счетов»: типы счетов из админки (`readAccountTypeTerms`) и отметка «ваш тип». */
export const dynamic = 'force-dynamic';

export default async function AccountsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const loaded = await loadAccountTerms(user.id);
  return <AccountsScreen data={loaded.state === 'ok' ? loaded.data : null} />;
}
