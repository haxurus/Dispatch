import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
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
  title: {
    default: 'Dispatch | Ticket Discord',
    template: '%s | Dispatch'
  },
  description: 'Dispatch è un sistema self-hosted di ticketing per Discord: pannelli, form, SLA, transcript, analytics e dashboard con permessi a ruoli.',
  applicationName: 'Dispatch'
};

export const viewport: Viewport = {
  themeColor: '#07111c',
  colorScheme: 'dark'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="it" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
