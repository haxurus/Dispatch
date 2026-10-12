import type { Metadata } from 'next';
import LegalPage from '../../_components/LegalPage';
import { publicPageMetadata } from '../../site';

export const metadata: Metadata = publicPageMetadata('en', {
  title: 'Privacy policy and terms of service | Dispatch',
  description: 'What data the Dispatch Discord ticket bot processes, why and for how long, your rights, and the terms of the hosted service.',
  path: '/legal'
});

export default function Page() {
  return <LegalPage locale="en" />;
}
