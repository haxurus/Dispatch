import type { MetadataRoute } from 'next';
import { LOCALES } from './i18n';
import { languageAlternates, SITE_URL } from './site';

const absolute = (languages: Record<string, string>) =>
  Object.fromEntries(Object.entries(languages).map(([lang, path]) => [lang, `${SITE_URL}${path}`]));

/** Public, indexable pages only: one entry per language, each listing its hreflang siblings. */
export default function sitemap(): MetadataRoute.Sitemap {
  return LOCALES.map((locale) => ({
    url: `${SITE_URL}/${locale}`,
    changeFrequency: 'weekly',
    priority: locale === 'en' ? 1 : 0.9,
    alternates: { languages: absolute(languageAlternates()) }
  }));
}
