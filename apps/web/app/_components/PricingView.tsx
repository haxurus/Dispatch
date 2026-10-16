'use client';

import { Icon } from './Brand';
import ContactList from './ContactList';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { chromeCopy, homeCopy, inviteHref, loginHref, type Locale } from '../i18n';
import { SITE_NAME } from '../site';
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  TIER_ORDER,
  featureLabels,
  featureShortLabels,
  formatLimit,
  formatPrice,
  formatRetention,
  limitLabels,
  storeHref,
  type PaidTier,
  type Plan,
  type PublicInfo
} from './plans';

const copy = {
  it: {
    nav: { home: 'Home', pricing: 'Prezzi', subscribe: 'Come abbonarsi', faq: 'FAQ' },
    kicker: 'Piani',
    title: 'Un piano per ogni server.',
    intro: 'Il piano Free include tutto il necessario per il supporto: ticket, pannelli, form, transcript, log dei ticket e valutazioni. I piani a pagamento alzano i limiti, allungano la conservazione e aggiungono automazioni, strumenti per lo staff e personalizzazione.',
    activation: 'I piani a pagamento sono abbonamenti mensili per server, acquistati e gestiti su Discord. Prezzi in dollari USA: Discord li mostra nella tua valuta al momento dell’acquisto.',
    offline: 'Al momento non è possibile caricare i dati aggiornati: sono mostrati i piani standard. Il prezzo esatto è quello indicato su Discord.',
    perMonth: '/mese',
    monthlySub: 'Abbonamento mensile su Discord',
    freeSub: 'Gratis, per sempre',
    level: 'LIVELLO',
    featured: 'Il più scelto',
    free: { cta: 'Aggiungi Dispatch', text: 'Ticket, pannelli, form, transcript, log dei ticket e valutazioni dello staff, per ogni server.' },
    tiers: {
      TIER1: 'Automazioni e thread staff privati, limiti più alti, conservazione più lunga e supporto prioritario.',
      TIER2: 'Tutto Plus, più la classifica dei moderatori, una categoria per i ticket chiusi e limiti più alti.',
      TIER3: 'Tutto Pro, più nickname e banner del bot nel tuo server, un footer dei pannelli personalizzato e i limiti più alti.'
    } satisfies Record<PaidTier, string>,
    subscribeCta: 'Abbonati su Discord',
    retention: 'di conservazione',
    categories: 'categorie',
    panels: 'pannelli ticket',
    forms: 'form',
    core: 'Ticket, pannelli, form e transcript',
    compare: 'Confronto completo',
    feature: 'Funzione',
    limitsGroup: 'Limiti per server',
    featuresGroup: 'Funzioni',
    coreRow: 'Ticket, pannelli, form, transcript, log dei ticket e valutazioni',
    included: 'Incluso',
    notIncluded: 'Non incluso',
    subscribeKicker: 'Abbonamento',
    subscribeTitle: 'Come abbonarsi',
    subscribeText: 'Gli abbonamenti si acquistano solo su Discord, dallo store di Dispatch, con i metodi di pagamento del tuo account Discord. Il sito non chiede mai dati di pagamento.',
    subscribeSteps: ['Apri lo store di Dispatch su Discord', 'Scegli il piano e il server', 'Il piano si attiva in pochi istanti'],
    store: 'Apri lo store su Discord',
    questions: 'Domande sui piani? Scrivici:',
    faqTitle: 'Domande sui piani',
    faq: [
      ['Come attivo un piano a pagamento?', 'Apri lo store di Dispatch su Discord (dai pulsanti di questa pagina o dal profilo del bot), scegli il piano e il server. Il piano si attiva da solo dopo il pagamento e la dashboard del server lo mostra subito.'],
      ['Come si paga?', 'Il pagamento avviene su Discord, con i metodi di pagamento del tuo account. Discord mostra il prezzo nella tua valuta, con le eventuali imposte, prima di confermare.'],
      ['Il piano vale per tutti i miei server?', 'No, ogni abbonamento vale per un singolo server e ne sblocca le funzioni per tutto lo staff di quel server.'],
      ['Posso cambiare piano o disdire?', 'Sì, in qualsiasi momento dalle impostazioni di Discord (Abbonamenti). Se disdici, il piano resta attivo fino alla fine del mese già pagato. I rimborsi seguono la politica di rimborso di Discord.'],
      ['Cosa succede quando l’abbonamento finisce?', 'Il server torna al piano Free: le funzioni non incluse smettono di funzionare e tornano i limiti del Free, compresa la conservazione massima, quindi ticket chiusi e transcript più vecchi vengono rimossi dalla pulizia automatica. Categorie, pannelli e form non vengono cancellati; vengono rimossi solo i ruoli della dashboard oltre il limite e il nickname e il banner personalizzati del bot.'],
      ['Il piano Free ha una scadenza?', 'No. Il piano Free resta disponibile per ogni server, senza limiti di tempo.']
    ] as Array<[string, string]>
  },
  en: {
    nav: { home: 'Home', pricing: 'Pricing', subscribe: 'How to subscribe', faq: 'FAQ' },
    kicker: 'Plans',
    title: 'A plan for every server.',
    intro: 'The Free plan includes everything a support desk needs: tickets, panels, forms, transcripts, the ticket log and ratings. Paid plans raise the limits, keep history longer and add automations, staff tools and branding.',
    activation: 'Paid plans are monthly subscriptions per server, bought and managed on Discord. Prices in US dollars: Discord shows them in your currency at checkout.',
    offline: 'Live data cannot be loaded right now: the standard plans are shown. The exact price is the one shown on Discord.',
    perMonth: '/month',
    monthlySub: 'Monthly subscription on Discord',
    freeSub: 'Free, forever',
    level: 'LEVEL',
    featured: 'Most popular',
    free: { cta: 'Add Dispatch', text: 'Tickets, panels, forms, transcripts, the ticket log and staff ratings, for every server.' },
    tiers: {
      TIER1: 'Automations and private staff threads, higher limits, longer retention and priority support.',
      TIER2: 'Everything in Plus, plus the moderator leaderboard, a category for closed tickets and higher limits.',
      TIER3: 'Everything in Pro, plus your own bot nickname and banner in your server, a custom panel footer and the highest limits.'
    } satisfies Record<PaidTier, string>,
    subscribeCta: 'Subscribe on Discord',
    retention: 'retention',
    categories: 'categories',
    panels: 'ticket panels',
    forms: 'forms',
    core: 'Tickets, panels, forms and transcripts',
    compare: 'Full comparison',
    feature: 'Feature',
    limitsGroup: 'Limits per server',
    featuresGroup: 'Features',
    coreRow: 'Tickets, panels, forms, transcripts, ticket log and ratings',
    included: 'Included',
    notIncluded: 'Not included',
    subscribeKicker: 'Subscription',
    subscribeTitle: 'How to subscribe',
    subscribeText: 'Subscriptions are bought only on Discord, from the Dispatch store, with the payment methods of your Discord account. The site never asks for payment details.',
    subscribeSteps: ['Open the Dispatch store on Discord', 'Pick the plan and the server', 'The plan is active within moments'],
    store: 'Open the store on Discord',
    questions: 'Questions about plans? Get in touch:',
    faqTitle: 'Questions about plans',
    faq: [
      ['How do I get a paid plan?', 'Open the Dispatch store on Discord (from the buttons on this page or from the bot’s profile) and pick the plan and the server. The plan turns on by itself once paid, and your server dashboard shows it right away.'],
      ['How do I pay?', 'You pay on Discord, with the payment methods of your account. Discord shows the price in your currency, with any taxes, before you confirm.'],
      ['Does a plan cover all my servers?', 'No, each subscription covers one server and unlocks its features for that server’s whole staff.'],
      ['Can I change plan or cancel?', 'Yes, at any time from your Discord settings (Subscriptions). If you cancel, the plan stays active until the end of the month already paid. Refunds follow Discord’s refund policy.'],
      ['What happens when a subscription ends?', 'The server goes back to Free: features outside it stop working and the Free limits apply again, including the maximum retention, so older closed tickets and transcripts are removed by the automatic cleanup. Categories, panels and forms are not deleted; only dashboard roles above the limit and the custom bot nickname and banner are removed.'],
      ['Does the Free plan expire?', 'No. The Free plan stays available to every server, with no time limit.']
    ] as Array<[string, string]>
  }
};

// JSON inside <script> must not be able to close the tag.
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

const isPaid = (tier: string): tier is PaidTier => tier === 'TIER1' || tier === 'TIER2' || tier === 'TIER3';

export default function PricingView({ locale, info, live, siteUrl }: { locale: Locale; info: PublicInfo; live: boolean; siteUrl: string }) {
  const c = copy[locale];
  const chrome = chromeCopy[locale];
  const invite = inviteHref(locale);
  const plans = TIER_ORDER
    .map((tier) => info.plans.find((plan) => plan.tier === tier))
    .filter((plan): plan is Plan => plan !== undefined);
  const limits = limitLabels(locale);
  const features = featureLabels(locale);
  const shortFeatures = featureShortLabels(locale);
  const check = (value: boolean) => value
    ? <span className="cell-yes" role="img" aria-label={c.included}><Icon name="check" size={16} /></span>
    : <span className="cell-no" role="img" aria-label={c.notIncluded}>—</span>;

  const structured = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      url: `${siteUrl}/${locale}/pricing`,
      description: c.intro,
      applicationCategory: 'CommunicationApplication',
      operatingSystem: 'Discord',
      offers: plans.map((plan) => ({
        '@type': 'Offer', name: plan.name, price: (plan.monthlyCents / 100).toFixed(2), priceCurrency: 'USD'
      }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: locale,
      mainEntity: c.faq.map(([question, answer]) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } }))
    }
  ];

  return (
    <main className="public-site" lang={locale}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <SiteHeader
        locale={locale}
        itHref="/it/pricing"
        enHref="/en/pricing"
        links={[
          { href: `/${locale}`, label: c.nav.home },
          { href: `/${locale}/pricing`, label: c.nav.pricing, current: true },
          { href: '#subscribe', label: c.nav.subscribe },
          { href: '#pricing-faq', label: c.nav.faq }
        ]}
        actions={<>
          <a className="button button-ghost" href={loginHref}>{chrome.signIn}</a>
          <a className="button button-primary" href={invite}>{chrome.addToDiscord}</a>
        </>}
      />

      <section className="page pricing-page">
        <div className="site-container">
          <div className="section-head pricing-head">
            <span className="kicker">{c.kicker}</span>
            <h1>{c.title}</h1>
            <p>{c.intro}</p>
          </div>

          <div className="notice pricing-notice"><Icon name="key" size={16} /><span>{c.activation}</span></div>
          {!live && <div className="notice notice-warn pricing-notice"><Icon name="clock" size={16} /><span>{c.offline}</span></div>}

          <div className="plan-grid">
            {plans.map((plan) => {
              const free = plan.tier === 'FREE';
              const featured = plan.tier === 'TIER2';
              const included = FEATURE_KEYS.filter((key) => plan.features[key]);
              return (
                <article className={`plan-card${featured ? ' plan-featured' : ''}`} key={plan.tier}>
                  <div className="plan-card-top">
                    <span className="plan-level mono">{free ? 'FREE' : `${c.level} ${plan.level}`}</span>
                    {featured && <span className="tag tag-accent">{c.featured}</span>}
                  </div>
                  <h2>{plan.name}</h2>
                  <div className="plan-price">
                    <strong>{formatPrice(free ? 0 : plan.monthlyCents, locale)}</strong>
                    {!free && <span>{c.perMonth}</span>}
                  </div>
                  <p className="plan-sub">{free ? c.freeSub : c.monthlySub}</p>
                  <p className="plan-text">{isPaid(plan.tier) ? c.tiers[plan.tier] : c.free.text}</p>
                  <ul className="plan-points">
                    <li><Icon name="clock" size={15} /><span>{formatRetention(plan.limits.retentionDays, locale)} {c.retention}</span></li>
                    <li><Icon name="grid" size={15} /><span>{formatLimit('categories', plan.limits.categories, locale)} {c.categories} · {formatLimit('ticketPanels', plan.limits.ticketPanels, locale)} {c.panels}</span></li>
                    <li><Icon name="clipboard" size={15} /><span>{formatLimit('forms', plan.limits.forms, locale)} {c.forms}</span></li>
                    {free && <li><Icon name="check" size={15} /><span>{c.core}</span></li>}
                    {included.map((key) => <li key={key}><Icon name="check" size={15} /><span>{shortFeatures[key]}</span></li>)}
                  </ul>
                  {free
                    ? <a className="button button-lg button-secondary" href={invite}>{c.free.cta}<Icon name="arrowRight" size={15} /></a>
                    : <a className={`button button-lg ${featured ? 'button-primary' : 'button-secondary'}`} href={storeHref(plan.tier as PaidTier)}>{c.subscribeCta}<Icon name="arrowRight" size={15} /></a>}
                </article>
              );
            })}
          </div>

          <section className="compare" aria-labelledby="compare-title">
            <h2 id="compare-title">{c.compare}</h2>
            <div className="compare-scroll">
              <table className="compare-table">
                <thead>
                  <tr><th scope="col">{c.feature}</th>{plans.map((plan) => <th scope="col" key={plan.tier}>{plan.name}</th>)}</tr>
                </thead>
                <tbody>
                  <tr><td>{c.coreRow}</td>{plans.map((plan) => <td key={plan.tier}>{check(true)}</td>)}</tr>
                  <tr className="compare-group"><th scope="rowgroup" colSpan={plans.length + 1}>{c.limitsGroup}</th></tr>
                  {LIMIT_KEYS.map((key) => (
                    <tr key={key}><td>{limits[key]}</td>{plans.map((plan) => <td key={plan.tier} className="mono">{formatLimit(key, plan.limits[key], locale)}</td>)}</tr>
                  ))}
                  <tr className="compare-group"><th scope="rowgroup" colSpan={plans.length + 1}>{c.featuresGroup}</th></tr>
                  {FEATURE_KEYS.map((key) => (
                    <tr key={key}><td>{features[key]}</td>{plans.map((plan) => <td key={plan.tier}>{check(Boolean(plan.features[key]))}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="pricing-bottom">
            <div className="card card-feature pricing-contact" id="subscribe">
              <span className="kicker">{c.subscribeKicker}</span>
              <h2>{c.subscribeTitle}</h2>
              <p>{c.subscribeText}</p>
              <ol className="pricing-steps">
                {c.subscribeSteps.map((step, index) => (
                  <li key={step}><span className="mono">{String(index + 1).padStart(2, '0')}</span>{step}</li>
                ))}
              </ol>
              <a className="button button-lg button-primary pricing-store" href={storeHref()}>{c.store}<Icon name="arrowRight" size={15} /></a>
              <p className="pricing-questions">{c.questions}</p>
              <ContactList contacts={info.contacts} locale={locale} />
            </div>
            <div className="card pricing-faq" id="pricing-faq">
              <h2>{c.faqTitle}</h2>
              <div className="faq-list">
                {c.faq.map(([question, answer]) => (
                  <details key={question}><summary>{question}</summary><p>{answer}</p></details>
                ))}
              </div>
            </div>
          </section>
        </div>
      </section>

      <SiteFooter locale={locale}>
        <div className="footer-main">
          <p>{homeCopy[locale].footer}</p>
          <nav aria-label={chrome.mainNav}>
            <a href={`/${locale}`}>{c.nav.home}</a>
            <a href="#subscribe">{c.nav.subscribe}</a>
            <a href="/dashboard">{chrome.dashboard}</a>
            <a href={invite}>{chrome.addToDiscord}</a>
          </nav>
        </div>
      </SiteFooter>
    </main>
  );
}
