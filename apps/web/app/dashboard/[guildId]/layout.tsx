import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import GuildShell from '../../_components/GuildShell';

export const metadata: Metadata = {
  title: 'Dashboard server',
  robots: { index: false, follow: false }
};

export default function GuildLayout({ children }: { children: ReactNode }) {
  return <GuildShell>{children}</GuildShell>;
}
