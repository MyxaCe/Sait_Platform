import type { Querier } from './projection';

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
