import type { Metadata } from 'next';
import { headers } from 'next/headers';
import SuperConsole from '../_components/SuperConsole';
import { LocaleProvider } from '../_components/locale-context';
import { isLocale } from '../i18n';
import { LOCALE_HEADER } from '../site';

export const metadata: Metadata = {
  title: 'Super console',
  robots: { index: false, follow: false, nocache: true }
};

export default async function Page() {
  const requested = (await headers()).get(LOCALE_HEADER);
  const locale = isLocale(requested) ? requested : 'en';
  return <LocaleProvider locale={locale}><SuperConsole locale={locale} /></LocaleProvider>;
}
