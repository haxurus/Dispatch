import type { MetadataRoute } from 'next';
import { LOCALES } from './i18n';
import { languageAlternates, SITE_URL } from './site';

const absolute = (languages: Record<string, string>) =>
  Object.fromEntries(Object.entries(languages).map(([lang, path]) => [lang, `${SITE_URL}${path}`]));

/** Public, indexable pages only: one entry per language, each listing its hreflang siblings. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { path: '', changeFrequency: 'weekly' as const, priority: 1 },
    { path: '/legal', changeFrequency: 'yearly' as const, priority: 0.3 }
  ];
  return pages.flatMap((page) => LOCALES.map((locale) => ({
    url: `${SITE_URL}/${locale}${page.path}`,
    changeFrequency: page.changeFrequency,
    priority: locale === 'en' ? page.priority : Math.round(page.priority * 90) / 100,
    alternates: { languages: absolute(languageAlternates(page.path)) }
  })));
}
