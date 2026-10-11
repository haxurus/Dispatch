import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { isLocale } from './i18n';
import { LOCALE_HEADER, SITE_NAME, SITE_URL } from './site';
import './globals.css';

// Geist and Geist Mono (SIL OFL 1.1, see ./fonts/OFL.txt) are committed and
// served from our own origin, so the CSP `font-src 'self'` keeps working and
// builds need no network access.
const sans = localFont({
  src: './fonts/Geist-Variable.woff2',
  variable: '--font-sans',
  weight: '100 900',
  style: 'normal',
  display: 'swap'
});

const mono = localFont({
  src: './fonts/GeistMono-Variable.woff2',
  variable: '--font-mono',
  weight: '100 900',
  style: 'normal',
  display: 'swap'
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Dispatch | Discord ticket bot with forms and transcripts',
    template: '%s | Dispatch'
  },
  description: 'Dispatch is a Discord ticket bot: ticket panels, forms and applications, claims, SLAs, transcripts, staff leaderboards and a web dashboard with role-based access.',
  applicationName: SITE_NAME,
  category: 'technology',
  creator: 'Haxurus',
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 }
};

export const viewport: Viewport = {
  themeColor: '#07111c',
  colorScheme: 'dark'
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requested = (await headers()).get(LOCALE_HEADER);
  const lang = isLocale(requested) ? requested : 'it';
  return (
    <html lang={lang} className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
