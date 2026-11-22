'use client';

import { useState, useTransition } from 'react';
import { Button } from '@broker/ui';
import { issueDocumentViewUrlAction } from '@/lib/kyc/documents';

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
