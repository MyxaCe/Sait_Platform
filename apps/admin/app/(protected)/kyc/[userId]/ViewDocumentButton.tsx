'use client';

import { useState, useTransition } from 'react';
import { Button } from '@broker/ui';
import { issueDocumentViewUrlAction } from '@/lib/kyc/documents';

/**
 * Кнопка «Просмотреть» документ (ADM-12). Зовёт server action, который выдаёт
 * ВРЕМЕННУЮ подписанную ссылку И журналирует доступ. Ссылку не рендерим в
 * разметку заранее: она короткоживущая и выдаётся только по нажатию (и только
 * залогировав просмотр). Открываем её в новой вкладке через `noopener`.
 */

const MESSAGES: Record<string, string> = {
  unauthorized: 'Сессия истекла — войдите заново.',
  notFound: 'Документ не найден.',
  unavailable: 'Хранилище недоступно — ссылку выдать не удалось.',
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
