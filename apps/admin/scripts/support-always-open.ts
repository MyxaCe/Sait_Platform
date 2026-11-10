import type { PoolLike } from '@broker/money';
import { loadSupportSettings, saveSupportSettings, type Actor } from '@broker/support';
import { readEnv } from '@broker/utils';
import { getPool } from '../lib/db';

/**
 * Поддержка «круглосуточно» (24/7) — включение на стенде при выкате.
 *
 * Владелец работает 24/7: при `hours.alwaysOpen = true` SLA первого ответа
 * считается без пауз (ночь/выходные/праздники не останавливают таймер),
 * виджет кабинета не показывает «вне рабочих часов», автоответ «вне часов» в
 * чате не отправляется (всё — через isWithinHours / addBusinessMinutes).
 * Значение по умолчанию в коде НЕ меняется (пн–пт 09–21 МСК).
 *
 * Идёт через saveSupportSettings: валидация + запись в журнал от имени
 * указанного admin-оператора с основанием (как кнопка «Сохранить» в
 * «Поддержка → Настройки»). Остальные настройки не трогаются.
 *
 *   DATABASE_URL=… pnpm --filter @broker/admin support:always-open -- --operator <login админа> [--off]
 *
 * Уже открытые обращения сохраняют прежний срок SLA (он фиксируется при
 * создании); новые считаются круглосуточно.
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<number> {
  if (!readEnv(process.env.DATABASE_URL)) {
    console.error('Отказ: DATABASE_URL не задан.');
    return 2;
  }
  const login = arg('--operator');
  if (!login) {
    console.error('Отказ: укажите --operator <login> — admin, от чьего имени запись в журнал.');
    return 2;
  }
  const on = !process.argv.includes('--off');
  const pool = getPool();
  const op = await pool.query(
    `SELECT id, display_name, role FROM operators WHERE login = $1 AND disabled_at IS NULL`,
    [login],
  );
  const row = op.rows[0] as { id: string; display_name: string; role: string } | undefined;
  if (!row || row.role !== 'admin') {
    console.error(`Отказ: активного admin-оператора «${login}» нет.`);
    return 2;
  }
  const db = pool as unknown as PoolLike;
  const cur = await loadSupportSettings(db);
  if (cur.hours.alwaysOpen === on) {
    console.info(`Без изменений: поддержка уже ${on ? 'круглосуточно' : 'по рабочим часам'}.`);
    return 0;
  }
  const actor: Actor = { operatorId: row.id, role: 'admin', displayName: row.display_name };
  const r = await saveSupportSettings(
    db,
    actor,
    { ...cur, hours: { ...cur.hours, alwaysOpen: on } },
    on ? 'Поддержка работает 24/7 (решение владельца, выкат стенда)' : 'Возврат к рабочим часам',
  );
  if (!r.ok) {
    console.error(`Не сохранено: ${r.reason}${'errors' in r && r.errors ? ` ${JSON.stringify(r.errors)}` : ''}`);
    return 1;
  }
  console.info(`Готово: поддержка ${on ? 'круглосуточно (24/7)' : 'по рабочим часам'}; запись в журнале от ${login}.`);
  return 0;
}

main()
  .then((code) => getPool().end().then(() => process.exit(code)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
