'use client';

import { useEffect } from 'react';

/**
 * Fallback only: middleware.ts redirects `/` on the server. Without it, pick
 * the public home language from the browser (English by default).
 */
export default function LanguageRedirect() {
  useEffect(() => {
    const languages = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language].filter(Boolean);
    const preferred = languages
      .map((value) => String(value).toLowerCase().split(/[-_]/)[0])
      .find((value) => value === 'it' || value === 'en') ?? 'en';
    window.location.replace(`/${preferred}`);
  }, []);

  return (
    <main className="language-redirect">
      <p>Dispatch · <a href="/en" hrefLang="en">English</a> · <a href="/it" hrefLang="it">Italiano</a></p>
    </main>
  );
}
