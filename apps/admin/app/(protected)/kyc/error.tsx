'use client';

import { SectionError } from '../clients/_components/SectionError';

export default function KycError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError title="Раздел «Верификация» не загрузился" reset={reset} digest={error.digest} />;
}
