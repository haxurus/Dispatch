'use client';

import { useState } from 'react';
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
  formatDate,
  formatLimit,
  formatPrice,
  formatRetention,
  limitLabels,
  type PaidTier,
  type Plan,
  type Promotion,
  type PublicInfo
} from './plans';

type Billing = 'MONTHLY' | 'YEARLY';

const copy = {
  it: {
    nav: { home: 'Home', pricing: 'Prezzi', contact: 'Contatti', faq: 'FAQ' },
    kicker: 'Piani',
    title: 'Un piano per ogni server.',
    intro: 'Il piano Free include tutto il necessario per il supporto: ticket, pannelli, form, transcript, log dei ticket e valutazioni. I piani a pagamento alzano i limiti, allungano la conservazione e aggiungono automazioni, strumenti per lo staff e personalizzazione.',
    activation: 'Nessun pagamento online: il proprietario del server contatta il gestore, paga come concordato e il gestore attiva il piano sul server. Prezzi in euro, per server.',
    offline: 'Al momento non è possibile caricare i dati aggiornati: sono mostrati i piani standard, senza promozioni. Per conferma sui prezzi contatta il gestore.',
    billing: 'Fatturazione',
    monthly: 'Mensile',
    yearly: 'Annuale',
    perMonth: '/mese',
    perYear: '/anno',
    orYearly: (price: string) => `oppure ${price}/anno`,
    save: (amount: string) => `risparmi ${amount} all’anno`,
    freeSub: 'Gratis, per sempre',
    level: 'LIVELLO',
    featured: 'Il più scelto',
    free: { cta: 'Aggiungi Dispatch', text: 'Ticket, pannelli, form, transcript, log dei ticket e valutazioni dello staff, per ogni server.' },
    tiers: {
      TIER1: 'Automazioni e thread staff privati, limiti più alti, conservazione più lunga e supporto prioritario.',
      TIER2: 'Tutto Plus, più la classifica dei moderatori, una categoria per i ticket chiusi e i limiti più alti.',
      TIER3: 'Tutto Pro, più nickname e banner del bot nel tuo server e un footer dei pannelli personalizzato.'
    } satisfies Record<PaidTier, string>,
    request: 'Richiedi il piano',
    retention: 'di conservazione',
    categories: 'categorie',
    panels: 'pannelli ticket',
    forms: 'form',
    core: 'Ticket, pannelli, form e transcript',
    multiTitle: 'Più server, meno spesa',
    multiText: 'Se paghi i piani di più server insieme hai uno sconto su ciascuno:',
    multiItem: (count: number, percent: number) => `${count} o più server: −${percent}%`,
    promoTitle: 'Promozioni in corso',
    promoText: 'Indica il codice quando contatti il gestore.',
    promoAllPlans: 'Tutti i piani a pagamento',
    promoMonthly: 'solo fatturazione mensile',
    promoYearly: 'solo fatturazione annuale',
    promoUntil: (date: string) => `valida fino al ${date}`,
    compare: 'Confronto completo',
    feature: 'Funzione',
    limitsGroup: 'Limiti per server',
    featuresGroup: 'Funzioni',
    coreRow: 'Ticket, pannelli, form, transcript, log dei ticket e valutazioni',
    included: 'Incluso',
    notIncluded: 'Non incluso',
    contactKicker: 'Contatti',
    contactTitle: 'Attiva un piano',
    contactText: 'Scrivi al gestore indicando il server (nome o ID) e il piano che ti interessa: concordate prezzo e modalità di pagamento e, ricevuto il pagamento, il piano viene attivato sul server. Puoi scrivere anche per domande o per una prova.',
    contactSteps: ['Contatta il gestore', 'Paga come concordato', 'Il piano viene attivato'],
    faqTitle: 'Domande sui piani',
    faq: [
      ['Come attivo un piano a pagamento?', 'Contatta il gestore con uno dei recapiti qui sopra indicando il server e il piano. Concordate prezzo e pagamento; ricevuto il pagamento, il gestore attiva il piano e la dashboard del server lo mostra subito.'],
      ['Come si paga?', 'Non c’è un pagamento online sul sito: prezzo e modalità di pagamento vengono concordati direttamente con il gestore prima dell’attivazione. Il sito non chiede mai dati di pagamento.'],
      ['Il piano vale per tutti i miei server?', 'No, ogni piano vale per un singolo server. Se attivi piani su più server insieme hai uno sconto su ciascuno.'],
      ['Cosa succede alla scadenza?', 'Il server torna al piano Free: le funzioni non incluse smettono di funzionare e tornano i limiti del Free, compresa la conservazione massima, quindi ticket chiusi e transcript più vecchi vengono rimossi dalla pulizia automatica. Categorie, pannelli e form non vengono cancellati; vengono rimossi solo i ruoli della dashboard oltre il limite e il nickname e il banner personalizzati del bot.'],
      ['Posso cambiare piano o disdire?', 'Sì: scrivi al gestore per passare a un altro piano. Non ci sono rinnovi automatici, quindi se non rinnovi il piano scade da solo alla fine del periodo pagato.'],
      ['Il piano Free ha una scadenza?', 'No. Il piano Free resta disponibile per ogni server, senza limiti di tempo.']
    ] as Array<[string, string]>
  },
  en: {
    nav: { home: 'Home', pricing: 'Pricing', contact: 'Contact', faq: 'FAQ' },
    kicker: 'Plans',
    title: 'A plan for every server.',
    intro: 'The Free plan includes everything a support desk needs: tickets, panels, forms, transcripts, the ticket log and ratings. Paid plans raise the limits, keep history longer and add automations, staff tools and branding.',
    activation: 'No online checkout: the server owner contacts the operator, pays as agreed and the operator activates the plan on the server. Prices in euros, per server.',
    offline: 'Live data cannot be loaded right now: the standard plans are shown, without promotions. Contact the operator to confirm prices.',
    billing: 'Billing',
    monthly: 'Monthly',
    yearly: 'Yearly',
    perMonth: '/month',
    perYear: '/year',
    orYearly: (price: string) => `or ${price}/year`,
    save: (amount: string) => `save ${amount} a year`,
    freeSub: 'Free, forever',
    level: 'LEVEL',
    featured: 'Most popular',
    free: { cta: 'Add Dispatch', text: 'Tickets, panels, forms, transcripts, the ticket log and staff ratings, for every server.' },
    tiers: {
      TIER1: 'Automations and private staff threads, higher limits, longer retention and priority support.',
      TIER2: 'Everything in Plus, plus the moderator leaderboard, a category for closed tickets and the highest limits.',
      TIER3: 'Everything in Pro, plus your own bot nickname and banner in your server and a custom panel footer.'
    } satisfies Record<PaidTier, string>,
    request: 'Request this plan',
    retention: 'retention',
    categories: 'categories',
    panels: 'ticket panels',
    forms: 'forms',
    core: 'Tickets, panels, forms and transcripts',
    multiTitle: 'More servers, lower price',
    multiText: 'Pay for several servers together and each plan is discounted:',
    multiItem: (count: number, percent: number) => `${count} or more servers: −${percent}%`,
    promoTitle: 'Current promotions',
    promoText: 'Mention the code when you contact the operator.',
    promoAllPlans: 'All paid plans',
    promoMonthly: 'monthly billing only',
    promoYearly: 'yearly billing only',
    promoUntil: (date: string) => `valid until ${date}`,
    compare: 'Full comparison',
    feature: 'Feature',
    limitsGroup: 'Limits per server',
    featuresGroup: 'Features',
    coreRow: 'Tickets, panels, forms, transcripts, ticket log and ratings',
    included: 'Included',
    notIncluded: 'Not included',
    contactKicker: 'Contact',
    contactTitle: 'Activate a plan',
    contactText: 'Write to the operator with your server (name or ID) and the plan you want: you agree on the price and payment and, once paid, the plan is activated on your server. You can also write with questions or to ask for a trial.',
    contactSteps: ['Contact the operator', 'Pay as agreed', 'The plan is activated'],
    faqTitle: 'Questions about plans',
    faq: [
      ['How do I get a paid plan?', 'Contact the operator using one of the contacts above, with your server and the plan you want. You agree on the price and payment; once paid, the operator activates the plan and your server dashboard shows it right away.'],
      ['How do I pay?', 'There is no online checkout on the site: the price and the payment method are agreed directly with the operator before activation. The site never asks for payment details.'],
      ['Does a plan cover all my servers?', 'No, each plan covers one server. If you activate plans on several servers together, each one is discounted.'],
      ['What happens when a plan expires?', 'The server goes back to Free: features outside it stop working and the Free limits apply again, including the maximum retention, so older closed tickets and transcripts are removed by the automatic cleanup. Categories, panels and forms are not deleted; only dashboard roles above the limit and the custom bot nickname and banner are removed.'],
      ['Can I change plan or cancel?', 'Yes: write to the operator to switch plan. Nothing renews automatically, so if you do not renew, the plan simply expires at the end of the paid period.'],
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
  const [billing, setBilling] = useState<Billing>('MONTHLY');
  const plans = TIER_ORDER
    .map((tier) => info.plans.find((plan) => plan.tier === tier))
    .filter((plan): plan is Plan => plan !== undefined);
  const discounts = [...info.multiSubscriptionDiscounts].sort((a, b) => a.minSubscriptions - b.minSubscriptions);
  const limits = limitLabels(locale);
  const features = featureLabels(locale);
  const shortFeatures = featureShortLabels(locale);
  const planName = (tier: string) => plans.find((plan) => plan.tier === tier)?.name ?? tier;
  const check = (value: boolean) => value
    ? <span className="cell-yes" role="img" aria-label={c.included}><Icon name="check" size={16} /></span>
    : <span className="cell-no" role="img" aria-label={c.notIncluded}>—</span>;

  const promoDiscount = (promo: Promotion) => promo.percentOff
    ? `−${promo.percentOff}%`
    : promo.amountOffCents ? `−${formatPrice(promo.amountOffCents, locale)}` : '';
  const promoScope = (promo: Promotion) => [
    promo.tiers.length ? promo.tiers.map(planName).join(', ') : c.promoAllPlans,
    promo.billing === 'MONTHLY' ? c.promoMonthly : promo.billing === 'YEARLY' ? c.promoYearly : null,
    promo.validUntil ? c.promoUntil(formatDate(promo.validUntil, locale)) : null
  ].filter(Boolean).join(' · ');

  const structured = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      url: `${siteUrl}/${locale}/pricing`,
      description: c.intro,
      applicationCategory: 'CommunicationApplication',
      operatingSystem: 'Discord',
      offers: plans.flatMap((plan) => plan.tier === 'FREE'
        ? [{ '@type': 'Offer', name: plan.name, price: '0', priceCurrency: 'EUR' }]
        : [
            { '@type': 'Offer', name: `${plan.name} (${c.monthly})`, price: (plan.monthlyCents / 100).toFixed(2), priceCurrency: 'EUR' },
            { '@type': 'Offer', name: `${plan.name} (${c.yearly})`, price: (plan.yearlyCents / 100).toFixed(2), priceCurrency: 'EUR' }
          ])
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
          { href: '#contact', label: c.nav.contact },
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

          <div className="billing-toggle" role="group" aria-label={c.billing}>
            <button type="button" aria-pressed={billing === 'MONTHLY'} className={billing === 'MONTHLY' ? 'active' : ''} onClick={() => setBilling('MONTHLY')}>{c.monthly}</button>
            <button type="button" aria-pressed={billing === 'YEARLY'} className={billing === 'YEARLY' ? 'active' : ''} onClick={() => setBilling('YEARLY')}>{c.yearly}</button>
          </div>

          <div className="plan-grid">
            {plans.map((plan) => {
              const free = plan.tier === 'FREE';
              const featured = plan.tier === 'TIER2';
              const price = billing === 'YEARLY' ? plan.yearlyCents : plan.monthlyCents;
              const saving = plan.monthlyCents * 12 - plan.yearlyCents;
              const included = FEATURE_KEYS.filter((key) => plan.features[key]);
              return (
                <article className={`plan-card${featured ? ' plan-featured' : ''}`} key={plan.tier}>
                  <div className="plan-card-top">
                    <span className="plan-level mono">{free ? 'FREE' : `${c.level} ${plan.level}`}</span>
                    {featured && <span className="tag tag-accent">{c.featured}</span>}
                  </div>
                  <h2>{plan.name}</h2>
                  <div className="plan-price">
                    <strong>{formatPrice(free ? 0 : price, locale)}</strong>
                    {!free && <span>{billing === 'YEARLY' ? c.perYear : c.perMonth}</span>}
                  </div>
                  <p className={`plan-sub${!free && billing === 'YEARLY' && saving > 0 ? ' plan-sub-ok' : ''}`}>
                    {free
                      ? c.freeSub
                      : billing === 'YEARLY'
                        ? (saving > 0 ? c.save(formatPrice(saving, locale)) : ' ')
                        : c.orYearly(formatPrice(plan.yearlyCents, locale))}
                  </p>
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
                    : <a className={`button button-lg ${featured ? 'button-primary' : 'button-secondary'}`} href="#contact">{c.request}<Icon name="arrowRight" size={15} /></a>}
                </article>
              );
            })}
          </div>

          <div className="pricing-extras">
            {discounts.length > 0 && (
              <div className="card pricing-extra">
                <h2>{c.multiTitle}</h2>
                <p>{c.multiText}</p>
                <ul className="discount-list">
                  {discounts.map((discount) => (
                    <li key={discount.minSubscriptions}><Icon name="server" size={15} />{c.multiItem(discount.minSubscriptions, discount.percentOff)}</li>
                  ))}
                </ul>
              </div>
            )}
            {info.promotions.length > 0 && (
              <div className="card card-feature pricing-extra">
                <h2>{c.promoTitle}</h2>
                <p>{c.promoText}</p>
                <ul className="promo-list">
                  {info.promotions.map((promo) => (
                    <li key={promo.code}>
                      <div className="promo-head">
                        <strong className="mono promo-code">{promo.code}</strong>
                        {promoDiscount(promo) && <span className="tag tag-ok">{promoDiscount(promo)}</span>}
                      </div>
                      {promo.description && <p>{promo.description}</p>}
                      <span className="promo-scope">{promoScope(promo)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
            <div className="card card-feature pricing-contact" id="contact">
              <span className="kicker">{c.contactKicker}</span>
              <h2>{c.contactTitle}</h2>
              <p>{c.contactText}</p>
              <ol className="pricing-steps">
                {c.contactSteps.map((step, index) => (
                  <li key={step}><span className="mono">{String(index + 1).padStart(2, '0')}</span>{step}</li>
                ))}
              </ol>
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
            <a href="#contact">{c.nav.contact}</a>
            <a href="/dashboard">{chrome.dashboard}</a>
            <a href={invite}>{chrome.addToDiscord}</a>
          </nav>
        </div>
      </SiteFooter>
    </main>
  );
}
