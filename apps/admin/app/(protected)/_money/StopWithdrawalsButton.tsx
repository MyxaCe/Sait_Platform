'use client';

import { stopWithdrawalsAction } from '@/lib/crypto/actions';
import { ActionForm } from './ActionForm';

/** Аварийная кнопка: режим «Стоп» одним действием. Снимается только в настройках платформы. */
export function StopWithdrawalsButton() {
  return (
    <ActionForm
      action={stopWithdrawalsAction}
      submitLabel="Остановить выводы"
      variant="danger"
      okText="Выводы остановлены. Снять «Стоп» — в настройках платформы."
      reasonPlaceholder="Напр.: всплеск заявок с новых аккаунтов, подозрение на атаку ботов"
      confirm={{
        tone: 'danger',
        title: 'Остановить все выводы?',
        consequence:
          'Заявки продолжат приниматься, деньги клиентов будут удерживаться, но одобрить заявку и внести хэш отправки не сможет никто, включая администратора. Клиенты ничего нового не увидят. Снять «Стоп» можно в настройках платформы.',
        confirmLabel: 'Да, остановить выводы',
      }}
    />
  );
}
