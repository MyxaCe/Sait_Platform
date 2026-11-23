import Link from 'next/link';
import { Callout } from '@broker/ui';
import { AUTO_PAYOUT_CONNECTED, type WithdrawModeState } from '@broker/money';
import { fmtDateTime } from '@/lib/ui/format';

/** Плашка текущего режима вывода над очередью и на главной. «Ручной» — без плашки (обычный путь). */
export function WithdrawModeBanner({ state, isAdmin }: { state: WithdrawModeState; isAdmin: boolean }) {
  if (state.mode === 'stop') {
    const since = state.changedAt ? ` с ${fmtDateTime(state.changedAt)}` : '';
    const who = state.changedByLogin ? `, включил ${state.changedByLogin}` : '';
    return (
      <Callout tone="negative" title={`ВЫВОДЫ ОСТАНОВЛЕНЫ${since}${who}`}>
        Режим «Стоп»: заявки принимаются, деньги клиентов удерживаются, но одобрить заявку и внести хэш
        отправки не может никто, включая администратора. Вернуть деньги клиенту («Отклонить» / «Отменить
        с возвратом») можно. Уже отправленные до «Стопа» выплаты наблюдатель закрывает как обычно.{' '}
        {isAdmin ? (
          <Link href="/settings#withdraw-mode" className="text-accent font-medium hover:underline">
            Снять «Стоп» — в настройках платформы →
          </Link>
        ) : (
          'Снять «Стоп» может только администратор.'
        )}
      </Callout>
    );
  }
  if (state.mode === 'auto' && !AUTO_PAYOUT_CONNECTED) {
    return (
      <Callout tone="info" title="Режим «Авто»: автоотправка не подключена">
        Заявки исполняются как в «Ручном»: после одобрения отправьте USDT с кошелька биржи сами и внесите хэш.
      </Callout>
    );
  }
  return null;
}
