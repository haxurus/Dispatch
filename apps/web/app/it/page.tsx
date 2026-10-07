import type { Metadata } from 'next';
import PublicHome from '../_components/PublicHome';
import { homeCopy } from '../i18n';

export const metadata: Metadata = {
  title: { absolute: homeCopy.it.meta.title },
  description: homeCopy.it.meta.description
};

export default function Page() {
  return <PublicHome locale="it" />;
}
