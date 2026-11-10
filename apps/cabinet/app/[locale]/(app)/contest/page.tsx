import { setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@/lib/auth/require';
import { getDemoAccount } from '@/lib/data';
import { loadContests, loadLeaderboard } from '@/lib/promo';
import { ContestScreen } from '@/features/promo/ContestScreen';
import { defaultContest } from '@/features/promo/format';

/** «Конкурс»: турнир на демо-счетах — вкладки, правила, призы, лидерборд с моим местом. */
export const dynamic = 'force-dynamic';

export default async function ContestPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { id?: string };
}) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const [loaded, demo] = await Promise.all([
    loadContests(user.id, params.locale),
    getDemoAccount(user.id).catch(() => null),
  ]);
  const contests = loaded.state === 'ok' ? loaded.data : null;
  const selected =
    contests?.find((c) => c.promotionId === searchParams.id && c.phase !== 'draft') ?? (contests ? defaultContest(contests) : null);
  const board = selected ? await loadLeaderboard(selected.promotionId, user.id, params.locale) : null;

  return (
    <ContestScreen
      contests={contests}
      selected={selected}
      board={board?.state === 'ok' ? board.data : null}
      // Валюта демо-счёта — из его проекции; счёта ещё нет — валюта демо терминала по умолчанию.
      demoCurrency={demo?.currency ?? 'USD'}
    />
  );
}
