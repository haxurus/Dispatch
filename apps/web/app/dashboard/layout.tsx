import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../_components/locale-context';
import { isLocale } from '../i18n';
import { LOCALE_HEADER } from '../site';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false }
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const requested = (await headers()).get(LOCALE_HEADER);
  return <LocaleProvider locale={isLocale(requested) ? requested : 'en'}>{children}</LocaleProvider>;
}
