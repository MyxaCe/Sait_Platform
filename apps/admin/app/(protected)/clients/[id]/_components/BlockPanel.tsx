'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import {
  blockClientAction,
  unblockClientAction,
  revokeClientSessionsAction,
  type ClientActionState,
} from '@/lib/clients/actions';

/**
 * Панель блокировки клиента (ADM-02, §3.2, §5.4). Форма-с-основанием: поле
 * «Основание» обязательно, submit заблокирован без него; danger-действие
 * (блокировка) требует второго клика-подтверждения. Разблокировка и «погасить
 * сессии» — тоже с основанием (Р-394: основание у любого значимого действия).
 *
 * Роль-гейт (§3.2): панель РЕНДЕРИТСЯ только для admin (fail-closed — её просто
 * нет у operator, не «серая»). Экшены на сервере проверяют роль повторно.
 *
 * «Погасить сессии» и блокировка удаляют кабинетные сессии клиента той же
 * транзакцией, что и запись в журнал. Терминал теряет доступ не позже своего
 * TTL (кабинет больше не выдаёт ему токен) — подпись под кнопкой это говорит.
 */

const MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав: блокировка — действие администратора.',
  invalidClient: 'Клиент не указан.',
  missingReason: 'Нужно указать основание.',
  noClient: 'Клиент не найден.',
  alreadyInState: 'Клиент уже в этом состоянии — изменений нет.',
  journalUnavailable: 'Журнал недоступен — действие не зафиксировано.',
};

function Feedback({ state, okText }: { state: ClientActionState; okText: string }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
        {MESSAGES[state.error] ?? 'Действие не выполнено.'}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="rounded border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive">
        {okText}
      </p>
    );
  }
  return null;
}

const textareaCls =
  'w-full rounded border border-border bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent';

function SubmitButton({
  variant,
  label,
  reason,
}: {
  variant: 'danger' | 'secondary' | 'primary';
  label: string;
  reason: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending || reason.trim().length === 0}>
      {pending ? '…' : label}
    </Button>
  );
}

/** Блокировка — danger, подтверждение в два шага (§5.4). */
function BlockForm({ userId }: { userId: string }) {
  const [state, action] = useFormState<ClientActionState, FormData>(blockClientAction, {});
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={action} className="space-y-3 rounded border border-negative/30 bg-negative/5 p-4">
      <Feedback state={state} okText="Клиент заблокирован, его сессии погашены." />
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="block-reason" className="block text-sm font-medium text-primary">
        Основание блокировки
      </label>
      <textarea
        id="block-reason"
        name="reason"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={textareaCls}
        placeholder="Почему клиент блокируется (обязательно)"
      />
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm text-negative">
            Подтвердите: заблокировать клиента? Вход в кабинет и терминал будет закрыт,
            текущие сессии погашены.
          </p>
          <div className="flex gap-2">
            <SubmitButton variant="danger" label="Да, заблокировать" reason={reason} />
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="danger"
          disabled={reason.trim().length === 0}
          onClick={() => setConfirming(true)}
        >
          Заблокировать клиента
        </Button>
      )}
    </form>
  );
}

function UnblockForm({ userId }: { userId: string }) {
  const [state, action] = useFormState<ClientActionState, FormData>(unblockClientAction, {});
  const [reason, setReason] = useState('');

  return (
    <form action={action} className="space-y-3 rounded border border-border bg-elevated p-4">
      <Feedback state={state} okText="Клиент разблокирован." />
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="unblock-reason" className="block text-sm font-medium text-primary">
        Основание разблокировки
      </label>
      <textarea
        id="unblock-reason"
        name="reason"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={textareaCls}
        placeholder="Почему клиент разблокируется (обязательно)"
      />
      <SubmitButton variant="primary" label="Разблокировать" reason={reason} />
    </form>
  );
}

function RevokeSessionsForm({ userId }: { userId: string }) {
  const [state, action] = useFormState<ClientActionState, FormData>(revokeClientSessionsAction, {});
  const [reason, setReason] = useState('');

  return (
    <form action={action} className="space-y-3 rounded border border-border bg-elevated p-4">
      <Feedback state={state} okText="Сессии клиента погашены, запись в журнале." />
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="revoke-reason" className="block text-sm font-medium text-primary">
        Погасить сессии — основание
      </label>
      <textarea
        id="revoke-reason"
        name="reason"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={textareaCls}
        placeholder="Основание для гашения сессий (обязательно)"
      />
      <SubmitButton variant="secondary" label="Погасить сессии" reason={reason} />
      <p className="text-xs text-secondary">
        Клиент сразу выходит из кабинета; терминал не получит новый токен и закроет
        сессию не позже своего срока (до 15 минут). Блокировка не меняется — клиент
        может войти снова.
      </p>
    </form>
  );
}

export function BlockPanel({ userId, blocked }: { userId: string; blocked: boolean }) {
  return (
    <div className="space-y-4">
      {blocked ? <UnblockForm userId={userId} /> : <BlockForm userId={userId} />}
      <RevokeSessionsForm userId={userId} />
    </div>
  );
}
