import type { Metadata } from 'next';
import PublicHome from '../_components/PublicHome';
import { homeCopy } from '../i18n';
import { publicPageMetadata } from '../site';

export const metadata: Metadata = publicPageMetadata('en', homeCopy.en.meta);

export default function Page() {
  return <PublicHome locale="en" />;
}
