'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Icon, type IconName } from '../../_components/Brand';
import { useCopy, useLocale } from '../../_components/locale-context';
import {
  PLAN_FEATURES,
  PLAN_NAMES,
  PLAN_QUOTAS,
  apiErrorText,
  contactHref,
  pricingHref,
  usePlan,
  type BillingPeriod,
  type GuildPlan,
  type PlanFeature,
  type PlanQuota
} from '../../_components/plan-client';
import { format, type Locale } from '../../i18n';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';

type Role = {
  id: string;
  name: string;
  position: number;
  color?: number;
};

type Binding = {
  id: string;
  discordRoleId: string;
  accessLevel: AccessLevel;
};

const accessText: Record<AccessLevel, string> = {
  VIEWER: 'Viewer',
  MODERATOR: 'Moderator',
  ADMIN: 'Admin',
  OWNER: 'Owner'
};

type SectionKey = 'manage' | 'tickets' | 'system' | 'panels' | 'forms' | 'analytics' | 'security';

const it = {
  kicker: 'Server',
  title: 'Panoramica',
  intro: 'Scorciatoie alle sezioni del server e permessi di accesso alla dashboard.',
  accessPill: 'Accesso',
  loadError: 'Non hai accesso a questo server oppure Discord non è raggiungibile.',
  saveError: 'Impossibile aggiornare il permesso.',
  errors: {
    QUOTA_EXCEEDED: 'Limite di {limit} ruoli raggiunto con il tuo piano: passa a un piano superiore o rimuovi un permesso esistente.'
  } as Record<string, string>,
  sections: {
    manage: ['Ticket', 'Coda dei ticket, filtri per stato, dettaglio, note e azioni dello staff.'],
    tickets: ['Configurazione ticket', 'Categorie, ruoli staff, questionari, SLA, automazioni e risposte rapide.'],
    system: ['Sistema e menu', 'Lingua del bot, anti-spam globale, retention di transcript e canali, menu principale.'],
    panels: ['Pannelli', 'Messaggi Discord per aprire ticket e form: menu o pulsanti, embed, emoji e anteprima.'],
    forms: ['Form', 'Candidature e questionari con domande validate e permessi per ruolo.'],
    analytics: ['Analytics', 'Volumi, tempi medi, violazioni SLA, feedback e attività dello staff.'],
    security: ['Blacklist', 'Utenti esclusi dall’apertura di nuovi ticket, con scadenza e motivo.']
  } as Record<SectionKey, [string, string]>,
  accessKicker: 'Accessi',
  accessTitle: 'Permessi dashboard per ruolo',
  assigned: '{count} assegnati',
  accessHelp: 'Owner, Administrator e Manage Server ottengono accesso automaticamente. Qui puoi assegnare accesso agli altri ruoli.',
  accessFor: 'Accesso per {role}',
  noAccess: 'Nessun accesso',
  saving: 'Salvataggio…',
  loadingRoles: 'Caricamento ruoli…',
  readOnly: 'Accesso al pannello: {level}. La gestione dei permessi richiede il livello Admin o Owner.',
  plan: {
    kicker: 'Piano',
    title: 'Piano {plan}',
    unavailable: 'Impossibile caricare il piano del server.',
    billing: {
      MONTHLY: 'Mensile',
      YEARLY: 'Annuale',
      GIFT: 'Omaggio'
    } as Record<BillingPeriod, string>,
    free: 'Piano gratuito, senza scadenza.',
    validUntil: 'Valido fino al {date}.',
    noExpiry: 'Nessuna scadenza.',
    expired: 'Il piano {plan} è scaduto il {date}: valgono i limiti e le funzioni del piano Free finché non viene rinnovato. Nessun dato è stato eliminato.',
    expiredTag: 'Scaduto',
    usageTitle: 'Utilizzo',
    quotas: {
      categories: 'Categorie ticket',
      ticketPanels: 'Pannelli ticket',
      forms: 'Form',
      formPanels: 'Pannelli form',
      responseTemplates: 'Risposte rapide',
      roleBindings: 'Ruoli con accesso alla dashboard'
    } as Record<PlanQuota, string>,
    retention: 'Retention massima di transcript e ticket chiusi',
    retentionDays: '{days} giorni',
    retentionUnlimited: 'Illimitata',
    featuresTitle: 'Funzioni',
    features: {
      automations: 'SLA, escalation, preavviso e chiusura per inattività',
      staffThreads: 'Thread privati dello staff',
      leaderboard: 'Classifica dei moderatori',
      closedCategory: 'Categoria Discord per i ticket chiusi',
      customBranding: 'Nome e banner del bot, footer dei pannelli personalizzato',
      prioritySupport: 'Supporto prioritario'
    } as Record<PlanFeature, string>,
    included: 'Inclusa',
    notIncluded: 'Non inclusa',
    seePlans: 'Vedi i piani',
    howToUpgrade: 'Come passare a un piano superiore',
    upgradeHelp: 'I piani vengono attivati dall’operatore di Dispatch, senza pagamenti online: contattalo per attivare o rinnovare un piano.'
  }
};

const en: typeof it = {
  kicker: 'Server',
  title: 'Overview',
  intro: 'Shortcuts to the server sections and dashboard access permissions.',
  accessPill: 'Access',
  loadError: 'You do not have access to this server, or Discord cannot be reached.',
  saveError: 'The permission could not be updated.',
  errors: {
    QUOTA_EXCEEDED: 'Limit of {limit} roles reached on your plan: upgrade or remove an existing permission.'
  } as Record<string, string>,
  sections: {
    manage: ['Tickets', 'Ticket queue, status filters, details, notes and staff actions.'],
    tickets: ['Ticket setup', 'Categories, staff roles, questionnaires, SLAs, automations and canned replies.'],
    system: ['System and menu', 'Bot language, global anti-spam, transcript and channel retention, main menu.'],
    panels: ['Panels', 'Discord messages that open tickets and forms: menu or buttons, embed, emoji and preview.'],
    forms: ['Forms', 'Applications and questionnaires with validated questions and per-role permissions.'],
    analytics: ['Analytics', 'Volumes, average times, SLA breaches, feedback and staff activity.'],
    security: ['Blacklist', 'Users who cannot open new tickets, with expiry and reason.']
  },
  accessKicker: 'Access',
  accessTitle: 'Dashboard permissions by role',
  assigned: '{count} assigned',
  accessHelp: 'Owner, Administrator and Manage Server get access automatically. Here you can grant access to other roles.',
  accessFor: 'Access for {role}',
  noAccess: 'No access',
  saving: 'Saving…',
  loadingRoles: 'Loading roles…',
  readOnly: 'Dashboard access: {level}. Managing permissions requires the Admin or Owner level.',
  plan: {
    kicker: 'Plan',
    title: '{plan} plan',
    unavailable: 'The server plan could not be loaded.',
    billing: {
      MONTHLY: 'Monthly',
      YEARLY: 'Yearly',
      GIFT: 'Complimentary'
    },
    free: 'Free plan, no expiry.',
    validUntil: 'Valid until {date}.',
    noExpiry: 'No expiry.',
    expired: 'The {plan} plan expired on {date}: Free plan limits and features apply until it is renewed. No data has been deleted.',
    expiredTag: 'Expired',
    usageTitle: 'Usage',
    quotas: {
      categories: 'Ticket categories',
      ticketPanels: 'Ticket panels',
      forms: 'Forms',
      formPanels: 'Form panels',
      responseTemplates: 'Canned replies',
      roleBindings: 'Roles with dashboard access'
    },
    retention: 'Longest transcript and closed-ticket retention',
    retentionDays: '{days} days',
    retentionUnlimited: 'Unlimited',
    featuresTitle: 'Features',
    features: {
      automations: 'SLAs, escalation, inactivity warning and auto-close',
      staffThreads: 'Private staff threads',
      leaderboard: 'Moderator leaderboard',
      closedCategory: 'Discord category for closed tickets',
      customBranding: 'Bot name and banner, custom panel footer',
      prioritySupport: 'Priority support'
    },
    included: 'Included',
    notIncluded: 'Not included',
    seePlans: 'See plans',
    howToUpgrade: 'How to upgrade',
    upgradeHelp: 'Plans are activated by the Dispatch operator, with no online payments: contact them to activate or renew a plan.'
  }
};

const copy: Record<Locale, typeof it> = { it, en };

const sections = (guildId: string): Array<{ key: SectionKey; href: string; icon: IconName }> => [
  { key: 'manage', href: `/dashboard/${guildId}/tickets/manage`, icon: 'inbox' },
  { key: 'tickets', href: `/dashboard/${guildId}/tickets`, icon: 'ticket' },
  { key: 'system', href: `/dashboard/${guildId}/tickets/system`, icon: 'sliders' },
  { key: 'panels', href: `/dashboard/${guildId}/panels`, icon: 'panel' },
  { key: 'forms', href: `/dashboard/${guildId}/forms`, icon: 'clipboard' },
  { key: 'analytics', href: `/dashboard/${guildId}/tickets/analytics`, icon: 'chart' },
  { key: 'security', href: `/dashboard/${guildId}/tickets/security`, icon: 'ban' }
];

const roleColor = (color: number | undefined) =>
  color ? `#${color.toString(16).padStart(6, '0')}` : undefined;

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function PlanCard({ plan, text, locale }: { plan: GuildPlan; text: typeof it.plan; locale: Locale }) {
  const expired = plan.tier !== plan.effectiveTier;
  const limits = plan.plan.limits;
  const status = expired
    ? format(text.expired, { plan: PLAN_NAMES[plan.tier], date: plan.expiresAt ? formatDate(plan.expiresAt, locale) : '—' })
    : plan.effectiveTier === 'FREE'
      ? text.free
      : plan.expiresAt
        ? format(text.validUntil, { date: formatDate(plan.expiresAt, locale) })
        : text.noExpiry;

  return (
    <div className="panel plan-card">
      <div className="panel-title">
        <div>
          <p className="eyebrow">{text.kicker}</p>
          <h2>{format(text.title, { plan: PLAN_NAMES[plan.effectiveTier] })}</h2>
        </div>
        <div className="actions">
          {expired && <span className="tag tag-danger">{text.expiredTag}</span>}
          {!expired && plan.effectiveTier !== 'FREE' && plan.billing && <span className="tag tag-accent">{text.billing[plan.billing]}</span>}
        </div>
      </div>
      {expired ? <div className="notice notice-warn plan-card-status">{status}</div> : <p>{status}</p>}

      <h3 className="plan-card-subtitle">{text.usageTitle}</h3>
      <div className="plan-meters">
        {PLAN_QUOTAS.map((quota) => {
          const used = plan.usage[quota] ?? 0;
          const max = limits[quota];
          const ratio = Math.min(1, used / Math.max(1, max));
          return (
            <div className={`plan-meter ${used >= max ? 'is-full' : ratio >= 0.8 ? 'is-high' : ''}`.trim()} key={quota}>
              <div><span>{text.quotas[quota]}</span><strong className="mono">{used} / {max}</strong></div>
              <i><b style={{ width: `${Math.max(2, ratio * 100)}%` }} /></i>
            </div>
          );
        })}
      </div>

      <dl className="plan-facts">
        <div>
          <dt>{text.retention}</dt>
          <dd className="mono">{limits.retentionDays === null ? text.retentionUnlimited : format(text.retentionDays, { days: limits.retentionDays })}</dd>
        </div>
      </dl>

      <h3 className="plan-card-subtitle">{text.featuresTitle}</h3>
      <ul className="plan-features">
        {PLAN_FEATURES.map((feature) => {
          const included = plan.plan.features[feature];
          return (
            <li key={feature} className={included ? 'is-included' : 'is-missing'}>
              <Icon name={included ? 'check' : 'x'} size={15} />
              <span>{text.features[feature]}</span>
              <span className="visually-hidden">{included ? text.included : text.notIncluded}</span>
            </li>
          );
        })}
      </ul>

      <p className="plan-card-help">{text.upgradeHelp}</p>
      <div className="actions">
        <a className="button button-sm" href={pricingHref(locale)}>{text.seePlans}</a>
        <a className="button button-sm button-secondary" href={contactHref(locale)}>{text.howToUpgrade}</a>
      </div>
    </div>
  );
}

export default function GuildDashboardPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);
  const locale = useLocale();
  const { plan, loading: planLoading, reload: reloadPlan } = usePlan(guildId);

  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const bindingMap = useMemo(
    () => new Map(bindings.map((binding) => [binding.discordRoleId, binding.accessLevel])),
    [bindings]
  );

  const reload = async () => {
    const [accessResponse, resourcesResponse] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/access`),
      fetch(`/backend/api/guilds/${guildId}/resources`)
    ]);

    if (accessResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (!accessResponse.ok || !resourcesResponse.ok) {
      setError(c.loadError);
      return;
    }

    const accessData = await accessResponse.json();
    const resources = await resourcesResponse.json();
    setAccess(accessData.access);
    setRoles(resources.roles);

    if (accessData.access === 'ADMIN' || accessData.access === 'OWNER') {
      const bindingsResponse = await fetch(`/backend/api/guilds/${guildId}/access-bindings`);
      if (bindingsResponse.ok) setBindings(await bindingsResponse.json());
    }
  };

  useEffect(() => {
    void reload();
  }, [guildId]);

  const saveBinding = async (roleId: string, accessLevel: 'VIEWER' | 'MODERATOR' | 'ADMIN' | '') => {
    setSaving(roleId);
    setError('');

    try {
      const response = accessLevel
        ? await fetch(`/backend/api/guilds/${guildId}/access-bindings/${roleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessLevel })
          })
        : await fetch(`/backend/api/guilds/${guildId}/access-bindings/${roleId}`, {
            method: 'DELETE'
          });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(apiErrorText(c.errors, body, c.saveError));
        return;
      }

      await Promise.all([reload(), reloadPlan()]);
    } finally {
      setSaving(null);
    }
  };

  const canAdmin = access === 'ADMIN' || access === 'OWNER';
  const assignableRoles = roles.filter((role) => role.id !== guildId);

  return (
    <>
      <header className="workspace-head">
        <div>
          <span className="kicker">{c.kicker}</span>
          <h1>{c.title}</h1>
          <p>{c.intro}</p>
        </div>
        <div className="live-pill"><i />{c.accessPill} {access ? accessText[access] : '…'}</div>
      </header>

      <section className="content">
        {error && <div className="notice notice-error" role="alert">{error}</div>}

        <div className="quick-grid">
          {sections(guildId).map((section) => {
            const [title, text] = c.sections[section.key];
            return (
              <a className="quick-card" href={section.href} key={section.href}>
                <span className="feature-icon"><Icon name={section.icon} size={18} /></span>
                <strong>{title}</strong>
                <span>{text}</span>
              </a>
            );
          })}
        </div>

        {plan
          ? <PlanCard plan={plan} text={c.plan} locale={locale} />
          : !planLoading && access && <div className="notice">{c.plan.unavailable}</div>}

        {canAdmin ? (
          <div className="panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">{c.accessKicker}</p>
                <h2>{c.accessTitle}</h2>
              </div>
              <span className="tag">{format(c.assigned, { count: bindings.length })}</span>
            </div>
            <p>{c.accessHelp}</p>

            <div className="binding-list">
              {assignableRoles.map((role) => {
                const current = bindingMap.get(role.id) ?? '';
                return (
                  <div className="binding-row" key={role.id}>
                    <div>
                      <strong><i className="role-dot" style={{ background: roleColor(role.color) }} />{role.name}</strong>
                      <span className="mono">{role.id}</span>
                    </div>

                    <select
                      aria-label={format(c.accessFor, { role: role.name })}
                      value={current}
                      disabled={saving === role.id}
                      onChange={(event) => {
                        void saveBinding(
                          role.id,
                          event.target.value as 'VIEWER' | 'MODERATOR' | 'ADMIN' | ''
                        );
                      }}
                    >
                      <option value="">{c.noAccess}</option>
                      <option value="VIEWER">Viewer</option>
                      <option value="MODERATOR">Moderator</option>
                      <option value="ADMIN">Admin</option>
                    </select>

                    <em>{saving === role.id ? c.saving : ''}</em>
                  </div>
                );
              })}
              {assignableRoles.length === 0 && !error && <div className="empty">{c.loadingRoles}</div>}
            </div>
          </div>
        ) : (
          access && <div className="notice">{format(c.readOnly, { level: accessText[access] })}</div>
        )}
      </section>
    </>
  );
}
