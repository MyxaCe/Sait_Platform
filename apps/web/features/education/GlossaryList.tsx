'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Input } from '@broker/ui';
import { getGlossaryTerms } from './glossary-data';

export function GlossaryList() {
  const t = useTranslations('education');
  const locale = useLocale();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = getGlossaryTerms(locale).filter(
      (item) =>
        !q || item.term.toLowerCase().includes(q) || item.definition.toLowerCase().includes(q),
    );
    const byLetter = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const letter = item.term[0]!.toUpperCase();
      const list = byLetter.get(letter) ?? [];
      list.push(item);
      byLetter.set(letter, list);
    }
    return [...byLetter.entries()].sort(([a], [b]) => a.localeCompare(b, locale));
  }, [query, locale]);

  return (
    <div>
      <div className="max-w-md">
        <Input
          type="search"
          placeholder={t('glossaryPlaceholder')}
          aria-label={t('glossaryAria')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="mt-8 space-y-10">
        {groups.map(([letter, terms]) => (
          <section key={letter} aria-label={t('glossaryLetterAria', { letter })}>
            <h2 className="text-2xl font-semibold text-accent">{letter}</h2>
            <dl className="mt-4 space-y-4">
              {terms.map((item) => (
                <div key={item.term} className="rounded-2xl border border-border bg-card p-5">
                  <dt className="font-semibold text-primary">{item.term}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-secondary">
                    {item.definition}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="text-center text-secondary">{t('glossaryNotFound')}</p>
        )}
      </div>
    </div>
  );
}
