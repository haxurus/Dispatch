import type { Metadata } from 'next';
import PricingPage from '../../_components/PricingPage';
import { publicPageMetadata } from '../../site';

// Plans, contacts and promotions are read from the API on every request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = publicPageMetadata('en', {
  title: 'Pricing | Dispatch Discord ticket bot plans',
  description: 'Compare Dispatch plans: a free Discord ticket bot with panels, forms and transcripts, plus Plus, Pro and Brand plans with higher limits, longer retention, SLA automations, a moderator leaderboard and custom branding.',
  path: '/pricing'
});

export default function Page() {
  return <PricingPage locale="en" />;
}
