'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Callout } from '@broker/ui';

export default function SectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common');
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl pt-4">
      <Callout
        tone="warning"
        title={t('errorTitle')}
        actions={
          <Button size="sm" variant="secondary" onClick={reset}>
            {t('retry')}
          </Button>
        }
      >
        {t('errorText')}
      </Callout>
    </div>
  );
}
