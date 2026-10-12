'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from '../i18n';
import { LOCALE_COOKIE } from '../site';

/*
 * Language of the dashboard and the super console (not indexed, so no /en and
 * /it URLs). middleware.ts resolves it from the `dispatch_locale` cookie (set
 * when the visitor opens /en or /it, or picks a language here), otherwise from
 * Accept-Language, English by default; the server layout passes it down.
 */

const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

/** The page copy for the current language: `const c = useCopy(copy)`. */
export function useCopy<T>(copy: Record<Locale, T>): T {
  return copy[useLocale()];
}

/** Remembers the choice for a year and reloads the page in that language. */
export function setLocalePreference(locale: Locale) {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax${secure}`;
  window.location.reload();
}

/** IT / EN toggle for pages without /it and /en mirrors. */
export function LocaleToggle({ className = '' }: { className?: string }) {
  const locale = useLocale();
  return (
    <div className={`language-switcher ${className}`.trim()} aria-label={locale === 'it' ? 'Selettore lingua' : 'Language selector'}>
      {(['it', 'en'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={locale === value ? 'is-active' : ''}
          lang={value}
          aria-pressed={locale === value}
          onClick={() => { if (value !== locale) setLocalePreference(value); }}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
