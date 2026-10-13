import type { Metadata } from 'next';
import PricingPage from '../../_components/PricingPage';
import { publicPageMetadata } from '../../site';

// Plans, contacts and promotions are read from the API on every request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = publicPageMetadata('it', {
  title: 'Prezzi | Piani del bot ticket Dispatch per Discord',
  description: 'Confronta i piani di Dispatch: bot ticket per Discord gratuito con pannelli, form e transcript, più i piani Plus, Pro e Brand con limiti più alti, conservazione più lunga, automazioni SLA, classifica moderatori e personalizzazione.',
  path: '/pricing'
});

export default function Page() {
  return <PricingPage locale="it" />;
}
