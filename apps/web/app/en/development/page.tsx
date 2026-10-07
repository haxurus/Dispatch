import type { Metadata } from 'next';
import DevelopmentNotice from '../../_components/DevelopmentNotice';
import { developmentCopy } from '../../i18n';

export const metadata: Metadata = {
  title: developmentCopy.en.meta.title,
  description: developmentCopy.en.meta.description,
  robots: { index: false, follow: true }
};

export default function Page() {
  return <DevelopmentNotice locale="en" />;
}
