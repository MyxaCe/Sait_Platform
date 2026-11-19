'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { loadBackdropSymbols } from './backdrop-symbols';

const QuoteLinesCanvas = dynamic(
  () => import('./QuoteLinesCanvas').then((m) => m.QuoteLinesCanvas),
  { ssr: false },
);

export function HeroBackdrop({ candidates }: { candidates: string[] }) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const key = candidates.join(',');

  useEffect(() => {
    const abort = new AbortController();
    loadBackdropSymbols(key.split(',').filter(Boolean), abort.signal)
      .then(setSymbols)
      .catch(() => undefined);
    return () => abort.abort();
  }, [key]);

  if (symbols.length === 0) return null;
  return <QuoteLinesCanvas symbols={symbols} />;
}
