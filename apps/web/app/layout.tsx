import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Dispatch',
  description: 'Discord ticket management'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="it"><body>{children}</body></html>;
}
