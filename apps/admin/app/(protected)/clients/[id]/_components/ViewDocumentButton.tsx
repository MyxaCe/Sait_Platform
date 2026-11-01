'use client';

import { useState, useTransition } from 'react';
import { Button } from '@broker/ui';
import { issueDocumentViewUrlAction } from '@/lib/kyc/documents';

/**
 * Кнопка «Просмотреть» документ в карточке клиента (ADM-02, §3.2).
 *
 * Переиспользует СУЩЕСТВУЮЩИЙ server action `issueDocumentViewUrlAction`
 * (ADM-12, lib/kyc): он выдаёт короткоживущую подписанную ссылку И журналирует
 * доступ (`client.document.viewed`). Ссылку не рендерим заранее — только по
 * нажатию.
 *
 * **Инертное хранилище (нет S3).** Если бакет ещё не поднят, action вернёт
 * `unavailable` — показываем «просмотр недоступен», НЕ падаем: байтов нет, но
 * карточка и метаданные документа видны. Хранилище поднимает другой агент.
 */

const MESSAGES: Record<string, string> = {
  unauthorized: 'Сессия истекла — войдите заново.',
  notFound: 'Документ не найден.',
  unavailable: 'Просмотр недоступен: хранилище ещё не настроено.',
};

export function ViewDocumentButton({ docId }: { docId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await issueDocumentViewUrlAction(docId);
      if (result.ok) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else {
        setError(MESSAGES[result.reason] ?? 'Не удалось открыть документ.');
      }
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={onClick} disabled={pending}>
        {pending ? '…' : 'Просмотреть'}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-negative">
          {error}
        </span>
      ) : null}
    </span>
  );
}
