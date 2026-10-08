import type { Metadata } from 'next';
import DevelopmentNotice from '../../_components/DevelopmentNotice';
import { developmentCopy } from '../../i18n';

export const metadata: Metadata = {
  title: developmentCopy.it.meta.title,
  description: developmentCopy.it.meta.description,
  robots: { index: false, follow: true }
};

export default function Page() {
  return <DevelopmentNotice locale="it" />;
}
