import type { Locale } from '../i18n';
import { CONTACT_EMAIL, SUPPORT_SERVER_URL } from '../site';

/*
 * Shapes returned by GET /api/public/info. The plan catalogue lives in
 * packages/shared/src/plans.ts, which the web app cannot import: the pricing
 * page renders what the API returns and falls back to FALLBACK_PLANS (a copy of
 * that catalogue) only when the API is unreachable. Keep the two in sync.
 */
export type PlanTier = 'FREE' | 'TIER1' | 'TIER2' | 'TIER3';
export type PaidTier = Exclude<PlanTier, 'FREE'>;

export type PlanLimits = {
  categories: number;
  ticketPanels: number;
  forms: number;
  formPanels: number;
  responseTemplates: number;
  roleBindings: number;
  /** null = no limit. */
  retentionDays: number | null;
};

export type PlanFeatures = {
  automations: boolean;
  staffThreads: boolean;
  leaderboard: boolean;
  closedCategory: boolean;
  customBranding: boolean;
  prioritySupport: boolean;
};

export type Plan = {
  tier: PlanTier;
  name: string;
  level: number;
  monthlyCents: number;
  yearlyCents: number;
  limits: PlanLimits;
  features: PlanFeatures;
};

export type Contacts = { email: string | null; discord: string | null; url: string | null };
export type MultiSubscriptionDiscount = { minSubscriptions: number; percentOff: number };
export type Promotion = {
  code: string;
  description: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  tiers: string[];
  billing: string;
  validUntil: string | null;
};

export type PublicInfo = {
  contacts: Contacts;
  plans: Plan[];
  multiSubscriptionDiscounts: MultiSubscriptionDiscount[];
  promotions: Promotion[];
};

export const TIER_ORDER: PlanTier[] = ['FREE', 'TIER1', 'TIER2', 'TIER3'];


/** Copy of the shared catalogue, used only when the API cannot be reached. */
export const FALLBACK_PLANS: Plan[] = [
  {
    tier: 'FREE', name: 'Free', level: 0, monthlyCents: 0, yearlyCents: 0,
    limits: { categories: 3, ticketPanels: 2, forms: 2, formPanels: 2, responseTemplates: 5, roleBindings: 1, retentionDays: 15 },
    features: { automations: false, staffThreads: false, leaderboard: false, closedCategory: false, customBranding: false, prioritySupport: false }
  },
  {
    tier: 'TIER1', name: 'Plus', level: 1, monthlyCents: 199, yearlyCents: 1_999,
    limits: { categories: 10, ticketPanels: 5, forms: 5, formPanels: 5, responseTemplates: 15, roleBindings: 3, retentionDays: 30 },
    features: { automations: true, staffThreads: true, leaderboard: false, closedCategory: false, customBranding: false, prioritySupport: true }
  },
  {
    tier: 'TIER2', name: 'Pro', level: 2, monthlyCents: 499, yearlyCents: 4_999,
    limits: { categories: 30, ticketPanels: 15, forms: 15, formPanels: 25, responseTemplates: 25, roleBindings: 10, retentionDays: 60 },
    features: { automations: true, staffThreads: true, leaderboard: true, closedCategory: true, customBranding: false, prioritySupport: true }
  },
  {
    tier: 'TIER3', name: 'Brand', level: 3, monthlyCents: 899, yearlyCents: 8_999,
    limits: { categories: 50, ticketPanels: 25, forms: 30, formPanels: 25, responseTemplates: 50, roleBindings: 10, retentionDays: 90 },
    features: { automations: true, staffThreads: true, leaderboard: true, closedCategory: true, customBranding: true, prioritySupport: true }
  }
];

export const FALLBACK_DISCOUNTS: MultiSubscriptionDiscount[] = [
  { minSubscriptions: 5, percentOff: 25 },
  { minSubscriptions: 3, percentOff: 20 },
  { minSubscriptions: 2, percentOff: 15 }
];

/** Used when the operator has not set any contact in the super console. */
export const FALLBACK_CONTACTS: Contacts = { email: CONTACT_EMAIL, discord: null, url: SUPPORT_SERVER_URL };

export const hasContacts = (contacts: Contacts | null | undefined): contacts is Contacts =>
  Boolean(contacts && (contacts.email || contacts.discord || contacts.url));

export function formatPrice(cents: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

export const formatNumber = (value: number, locale: Locale) => value.toLocaleString(locale === 'it' ? 'it-IT' : 'en-US');

export function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function limitLabels(locale: Locale): Record<keyof PlanLimits, string> {
  return locale === 'it'
    ? {
        categories: 'Categorie di ticket',
        ticketPanels: 'Pannelli ticket',
        forms: 'Form',
        formPanels: 'Pannelli dei form',
        responseTemplates: 'Risposte rapide',
        roleBindings: 'Ruoli con accesso alla dashboard',
        retentionDays: 'Conservazione di ticket chiusi e transcript'
      }
    : {
        categories: 'Ticket categories',
        ticketPanels: 'Ticket panels',
        forms: 'Forms',
        formPanels: 'Form panels',
        responseTemplates: 'Canned replies',
        roleBindings: 'Roles with dashboard access',
        retentionDays: 'Closed ticket and transcript retention'
      };
}

export const LIMIT_KEYS: Array<keyof PlanLimits> = ['categories', 'ticketPanels', 'forms', 'formPanels', 'responseTemplates', 'roleBindings', 'retentionDays'];

export function formatRetention(days: number | null, locale: Locale) {
  if (days === null) return locale === 'it' ? 'Illimitata' : 'Unlimited';
  return locale === 'it' ? `${formatNumber(days, locale)} giorni` : `${formatNumber(days, locale)} days`;
}

export function formatLimit(key: keyof PlanLimits, value: number | null, locale: Locale) {
  if (key === 'retentionDays') return formatRetention(value, locale);
  return value === null ? (locale === 'it' ? 'Illimitati' : 'Unlimited') : formatNumber(value, locale);
}

export function featureLabels(locale: Locale): Record<keyof PlanFeatures, string> {
  return locale === 'it'
    ? {
        automations: 'Automazioni: SLA, escalation, avviso di inattività e chiusura automatica',
        staffThreads: 'Thread staff privati',
        leaderboard: 'Classifica moderatori settimanale e mensile',
        closedCategory: 'Ticket chiusi spostati in una categoria dedicata',
        customBranding: 'Nickname e banner del bot nel server, footer dei pannelli personalizzato',
        prioritySupport: 'Supporto prioritario'
      }
    : {
        automations: 'Automations: SLAs, escalation, inactivity warning and auto-close',
        staffThreads: 'Private staff threads',
        leaderboard: 'Weekly and monthly moderator leaderboard',
        closedCategory: 'Closed tickets moved to a dedicated category',
        customBranding: 'Bot nickname and banner in your server, custom panel footer',
        prioritySupport: 'Priority support'
      };
}

/** Shorter labels for the plan cards. */
export function featureShortLabels(locale: Locale): Record<keyof PlanFeatures, string> {
  return locale === 'it'
    ? {
        automations: 'SLA, escalation e chiusura automatica',
        staffThreads: 'Thread staff privati',
        leaderboard: 'Classifica moderatori',
        closedCategory: 'Categoria per i ticket chiusi',
        customBranding: 'Nickname, banner e footer personalizzati',
        prioritySupport: 'Supporto prioritario'
      }
    : {
        automations: 'SLAs, escalation and auto-close',
        staffThreads: 'Private staff threads',
        leaderboard: 'Moderator leaderboard',
        closedCategory: 'Category for closed tickets',
        customBranding: 'Custom nickname, banner and footer',
        prioritySupport: 'Priority support'
      };
}

export const FEATURE_KEYS: Array<keyof PlanFeatures> = ['automations', 'staffThreads', 'leaderboard', 'closedCategory', 'customBranding', 'prioritySupport'];
