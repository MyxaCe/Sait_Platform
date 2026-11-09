'use client';

import { SectionError } from '../clients/_components/SectionError';

export default function AmlError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError title="Раздел «AML-скрининг» не загрузился" reset={reset} digest={error.digest} />;
}
