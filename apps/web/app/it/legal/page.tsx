import type { Metadata } from 'next';
import LegalPage from '../../_components/LegalPage';
import { publicPageMetadata } from '../../site';

export const metadata: Metadata = publicPageMetadata('it', {
  title: 'Privacy policy e termini di servizio | Dispatch',
  description: 'Quali dati tratta il bot ticket Dispatch, perché e per quanto tempo, i tuoi diritti e i termini del servizio ospitato.',
  path: '/legal'
});

export default function Page() {
  return <LegalPage locale="it" />;
}
