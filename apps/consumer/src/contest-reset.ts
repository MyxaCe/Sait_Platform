import type { Querier } from './projection';

/**
 * КОНКУРС НА ДЕМО-СЧЕТАХ: сброс демо (`terminal.balance.changed` reason=reset)
 * ставит участнику базу (дизайн «ДЕМО-акции», `@broker/promo` contest-db).
 *
 *  - участия `pending_reset` → `active`, база = сумма, которую сброс
 *    ФАКТИЧЕСКИ применил (одинаковый старт у всех — от терминала, не из кода);
 *  - уже активные участия в идущем конкурсе: счётчик сбросов +1, при правиле
 *    акции `disqualifyOnReset` — дисквалификация.
 *
 * Доходность считается по realized P&L сделок ПОСЛЕ базы, поэтому повторный
 * сброс её не обнуляет.
 *
 * Под SAVEPOINT: таблицы конкурса может ещё не быть (консюмер выкатили раньше
 * миграции) — проекция денег важнее, её транзакция не должна упасть из-за
 * конкурса. Код здесь, а не в `@broker/promo`: образу консюмера пакет акций
 * (и денег) не нужен.
 */
export async function applyDemoResetToContests(
  db: Querier,
  input: { userId: string; balanceMinor: number; at: string },
): Promise<void> {
  await db.query('SAVEPOINT contest_reset');
  try {
    await db.query(
      `UPDATE contest_entries ce
          SET resets_count = ce.resets_count + 1,
              status = CASE WHEN COALESCE((p.rules->>'disqualifyOnReset')::boolean, false)
                            THEN 'disqualified' ELSE ce.status END,
              disqualified_reason = CASE WHEN COALESCE((p.rules->>'disqualifyOnReset')::boolean, false)
                                         THEN 'demo_reset' ELSE ce.disqualified_reason END,
              updated_at = now()
         FROM promotions p
        WHERE p.id = ce.promotion_id AND ce.user_id = $1 AND ce.status = 'active'
          AND ce.baseline_at < $2::timestamptz
          AND (p.ends_at IS NULL OR p.ends_at > $2::timestamptz)`,
      [input.userId, input.at],
    );
    if (input.balanceMinor > 0) {
      await db.query(
        `UPDATE contest_entries
            SET status = 'active', baseline_minor = $2, baseline_at = $3::timestamptz, updated_at = now()
          WHERE user_id = $1 AND status = 'pending_reset'`,
        [input.userId, input.balanceMinor, input.at],
      );
    }
    await db.query('RELEASE SAVEPOINT contest_reset');
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT contest_reset').catch(() => {});
    console.error('[consumer] конкурс: база по сбросу демо не записана', { userId: input.userId, error: String(error) });
  }
}
