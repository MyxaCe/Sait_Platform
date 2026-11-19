'use client';

import { createContext, useContext } from 'react';
import { COMPAT_SITE_LANGUAGES, type SiteLanguages } from '@broker/utils/locales';

const SiteLanguagesContext = createContext<SiteLanguages>(COMPAT_SITE_LANGUAGES);

export function SiteLanguagesProvider({ value, children }: { value: SiteLanguages; children: React.ReactNode }) {
  return <SiteLanguagesContext.Provider value={value}>{children}</SiteLanguagesContext.Provider>;
}

export function useSiteLanguages(): SiteLanguages {
  return useContext(SiteLanguagesContext);
}
