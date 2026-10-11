import type { Metadata } from 'next';
import type { Locale } from './i18n';

/*
 * Public origin used for canonical URLs, hreflang, the sitemap and Open Graph.
 * SITE_URL overrides it for other deployments; it is read at build time for
 * static output, so set it as a build arg there too.
 */
export const SITE_URL = (process.env.SITE_URL || 'https://dispatch.haxurus.com').replace(/\/+$/, '');

export const SITE_NAME = 'Dispatch';

/** Locale request header set by middleware.ts, read by the root layout for <html lang>. */
export const LOCALE_HEADER = 'x-dispatch-locale';

/** English is the international default (x-default) for the public site. */
export const DEFAULT_PUBLIC_LOCALE: Locale = 'en';

const ogLocale: Record<Locale, string> = { en: 'en_US', it: 'it_IT' };

export const languageAlternates = (path = '') => ({
  en: `/en${path}`,
  it: `/it${path}`,
  'x-default': `/${DEFAULT_PUBLIC_LOCALE}${path}`
});

/** Canonical, hreflang, Open Graph and Twitter metadata for a public localized page. */
export function publicPageMetadata(
  locale: Locale,
  { title, description, keywords, path = '' }: { title: string; description: string; keywords?: string[]; path?: string }
): Metadata {
  const url = `/${locale}${path}`;
  return {
    title: { absolute: title },
    description,
    keywords,
    alternates: { canonical: url, languages: languageAlternates(path) },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url,
      title,
      description,
      locale: ogLocale[locale],
      alternateLocale: Object.entries(ogLocale).filter(([key]) => key !== locale).map(([, value]) => value)
    },
    twitter: { card: 'summary_large_image', title, description }
  };
}
