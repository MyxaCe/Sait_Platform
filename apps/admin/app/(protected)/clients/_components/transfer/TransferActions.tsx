'use client';

import {
  closeSourceAction,
  completeRefundTaskAction,
  markTransfersSeenAction,
  retryDeliveryAction,
  revokeTransferAction,
} from '@/lib/transfer/actions';
import { transferErrorText } from '@/lib/transfer/labels';
import { ActionForm, ConfirmFacts } from '../../../_money/ActionForm';

/** Формы-с-основанием раздела «Переводы клиентов» (журнал, двухшаговые для опасных). */

export function RevokeTransferForm({
  transferId,
  number,
  clientName,
  stage,
}: {
  transferId: string;
  number: string;
  clientName: string;
  stage: 'before_registration' | 'after_registration';
}) {
  return (
    <ActionForm
      action={revokeTransferAction}
      submitLabel="Вернуть перевод"
      okText="Перевод возвращён."
      danger
      errorText={transferErrorText}
      reasonPlaceholder="Что не так с переводом (пишется в журнал и учитывается у менеджера)"
      confirm={{
        tone: 'danger',
        title: `Вернуть перевод ${number}?`,
        summary: (
          <ConfirmFacts
            rows={[
              ['Клиент', clientName],
              ['Стадия', stage === 'after_registration' ? 'клиент уже зарегистрирован в цели' : 'клиент ещё не зарегистрирован в цели'],
            ]}
          />
        ),
        consequence:
          stage === 'after_registration'
            ? 'Цель заморозит счёт клиента (торговля и вывод), напишет ему письмо; если он уже пополнил счёт — менеджеру цели будет поставлена задача вернуть средства выводом. Здесь клиент восстанавливается. Перевод засчитывается менеджеру как возвращённый.'
            : 'Цель отзовёт приглашение — ссылка регистрации станет недействительной. Здесь клиент восстанавливается. Перевод засчитывается менеджеру как возвращённый.',
        confirmLabel: 'Да, вернуть перевод',
      }}
    >
      <input type="hidden" name="transferId" value={transferId} />
    </ActionForm>
  );
}

export function CloseSourceForm({ transferId }: { transferId: string }) {
  return (
    <ActionForm
      action={closeSourceAction}
      submitLabel="Закрыть счёт здесь"
      okText="Счёт закрыт по переводу (торговля заморожена)."
      errorText={transferErrorText}
      reasonPlaceholder="Например: клиент подтвердил в тикете, что средства выведены и он работает в новой платформе"
      confirm={{
        tone: 'primary',
        title: 'Закрыть счёт клиента на этой платформе?',
        consequence:
          'Реальный счёт будет заморожен (торговля и вывод закрыты), вход в кабинет остаётся. Возможно только при нулевом балансе реального счёта.',
        confirmLabel: 'Да, закрыть счёт',
      }}
    >
      <input type="hidden" name="transferId" value={transferId} />
    </ActionForm>
  );
}

export function RetryDeliveryForm({ transferId }: { transferId: string }) {
  return (
    <ActionForm
      action={retryDeliveryAction}
      submitLabel="Повторить доставку"
      okText="Доставка запущена заново."
      variant="secondary"
      errorText={transferErrorText}
      reasonPlaceholder="Почему повторяем (например, цель снова доступна)"
    >
      <input type="hidden" name="transferId" value={transferId} />
    </ActionForm>
  );
}

export function RefundTaskForm({ transferId }: { transferId: string }) {
  return (
    <ActionForm
      action={completeRefundTaskAction}
      submitLabel="Средства возвращены"
      okText="Задача закрыта."
      variant="secondary"
      errorText={transferErrorText}
      reasonLabel="Как вернули"
      reasonPlaceholder="Номер заявки на вывод, сумма, дата"
    >
      <input type="hidden" name="transferId" value={transferId} />
    </ActionForm>
  );
}

export function MarkSeenForm() {
  return (
    <ActionForm
      action={markTransfersSeenAction}
      submitLabel="Отметить просмотренными"
      okText="Отмечено."
      variant="secondary"
      errorText={transferErrorText}
      reasonLabel="Комментарий"
      reasonPlaceholder="Например: проверено, вопросов нет"
    />
  );
}
