import Link from 'next/link';
import { Callout, Mono } from '@broker/ui';
import type { MailChannelState } from '@broker/support';
import { fmtDateTime } from '@/lib/ui/format';

/**
 * Состояние почтового канала (пишет воркер support-mail). Почта без env —
 * fail-closed: канал выключен, остальное работает; здесь — понятная причина.
 */
export function MailStatusCallout({
  state,
  emailEnabled,
  isAdmin,
  compact = false,
}: {
  state: MailChannelState & { queue: { queued: number; failed: number } };
  emailEnabled: boolean;
  isAdmin: boolean;
  compact?: boolean;
}) {
  if (!emailEnabled) {
    return (
      <Callout tone="neutral" title="Почтовый канал выключен в настройках">
        Письма в ящик поддержки не разбираются (ждут во входящих, ничего не теряется), ответить письмом нельзя.
        Сброс пароля и подтверждение email продолжают уходить.
        {isAdmin ? (
          <>
            {' '}
            <Link href="/support/settings" className="text-accent font-medium hover:underline">
              Настройки →
            </Link>
          </>
        ) : null}
      </Callout>
    );
  }
  if (state.state === 'notConfigured') {
    return (
      <Callout tone="warning" title="Почта не настроена">
        Нет данных ящика поддержки в окружении сервера — письма не уходят и не принимаются; чат и форма сайта работают.
        {compact ? null : (
          <>
            {' '}Не заданы: {state.missing.map((m, i) => (
              <span key={m}>
                {i ? ', ' : ''}
                <Mono value={m} className="text-[0.92em]" />
              </span>
            ))}
            . Ответы письмом и подтверждения копятся в очереди ({state.queue.queued}) и уйдут, когда ящик подключат.
          </>
        )}
      </Callout>
    );
  }
  if (state.state === 'workerDown') {
    return (
      <Callout tone="warning" title="Почтовый воркер не отвечает">
        {state.lastHeartbeatAt ? `Последняя отметка ${fmtDateTime(state.lastHeartbeatAt)}. ` : 'Воркер ни разу не отмечался. '}
        Письма копятся в очереди ({state.queue.queued}); обращения из чата и с сайта принимаются.
      </Callout>
    );
  }
  if (state.queue.failed > 0 || (state.lastErrorAt && (!state.lastOutboundOkAt || state.lastErrorAt > state.lastOutboundOkAt))) {
    return (
      <Callout tone="negative" title="Есть сбои доставки писем">
        {state.queue.failed > 0 ? `Не доставлено писем: ${state.queue.failed}. ` : null}
        {state.lastError ? <>Последняя ошибка{state.lastErrorAt ? ` (${fmtDateTime(state.lastErrorAt)})` : ''}: {state.lastError}</> : null}
      </Callout>
    );
  }
  return null;
}
