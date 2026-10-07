import { Icon } from './Brand';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { chromeCopy, homeCopy, inviteHref, loginHref, type Locale } from '../i18n';

export default function PublicHome({ locale }: { locale: Locale }) {
  const c = homeCopy[locale];
  const chrome = chromeCopy[locale];
  const invite = inviteHref(locale);

  return (
    <main className="public-site" lang={locale}>
      <SiteHeader
        locale={locale}
        itHref="/it"
        enHref="/en"
        links={[
          { href: '#features', label: c.nav.features },
          { href: '#flow', label: c.nav.flow },
          { href: '#security', label: c.nav.security }
        ]}
        actions={<>
          <a className="button button-ghost" href={loginHref}>{chrome.signIn}</a>
          <a className="button button-primary" href={invite}>{chrome.addToDiscord}</a>
        </>}
      />

      <section className="hero">
        <div className="site-container hero-grid">
          <div className="hero-copy">
            <span className="kicker">{c.hero.kicker}</span>
            <h1>{c.hero.title.map((line) => <span key={line}>{line}</span>)}</h1>
            <p>{c.hero.text}</p>
            <div className="hero-actions">
              <a className="button button-primary button-lg" href={loginHref}>{chrome.signInDiscord}<Icon name="arrowRight" size={16} /></a>
              <a className="button button-secondary button-lg" href={invite}><Icon name="plus" size={16} />{chrome.addToDiscord}</a>
            </div>
            <span className="hero-note"><Icon name="check" size={14} />{c.hero.note}</span>
          </div>

          <div className="stream" role="img" aria-label={c.hero.stream}>
            <div className="stream-top">
              <span className="mono">dispatch://{c.hero.stream}</span>
              <span className="live"><i />{c.hero.live}</span>
            </div>
            <ol className="stream-rows">
              {c.hero.rows.map((row) => (
                <li key={row.key + row.time}>
                  <time className="mono">{row.time}</time>
                  <div><strong className="mono">{row.key}</strong><span>{row.text}</span></div>
                  <span className={`state state-${row.state}`}>{row.label}</span>
                </li>
              ))}
            </ol>
            <div className="stream-bottom mono">
              {c.hero.footer.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        </div>

        <div className="site-container stat-strip">
          {c.stats.map(([value, label]) => (
            <div key={label}><strong>{value}</strong><span>{label}</span></div>
          ))}
        </div>
      </section>

      <section className="section" id="features">
        <div className="site-container">
          <div className="section-head">
            <span className="kicker">{c.features.kicker}</span>
            <h2>{c.features.title}</h2>
            <p>{c.features.intro}</p>
          </div>
          <div className="feature-grid">
            {c.features.cards.map((card) => (
              <article className="feature" key={card.title}>
                <div className="feature-icon"><Icon name={card.icon} size={20} /></div>
                <span className="feature-kicker">{card.kicker}</span>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt" id="flow">
        <div className="site-container">
          <div className="section-head">
            <span className="kicker">{c.flow.kicker}</span>
            <h2>{c.flow.title}</h2>
          </div>
          <ol className="pipeline">
            {c.flow.steps.map((step, index) => (
              <li key={step.title}>
                <div className="pipeline-node"><Icon name={step.icon} size={20} /><span className="mono">{String(index + 1).padStart(2, '0')}</span></div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="site-container steps-layout">
          <div className="section-head">
            <span className="kicker">{c.how.kicker}</span>
            <h2>{c.how.title}</h2>
          </div>
          <ol className="steps">
            {c.how.steps.map(([title, text], index) => (
              <li key={title}>
                <span className="step-index mono">{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{title}</h3><p>{text}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section-alt" id="security">
        <div className="site-container security-layout">
          <div className="section-head">
            <span className="kicker">{c.security.kicker}</span>
            <h2>{c.security.title}</h2>
            <p>{c.security.text}</p>
          </div>
          <dl className="security-list">
            {c.security.items.map(([title, text]) => (
              <div key={title}><dt><Icon name="check" size={16} />{title}</dt><dd>{text}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      <section className="section cta-section">
        <div className="site-container cta">
          <div><h2>{c.cta.title}</h2><p>{c.cta.text}</p></div>
          <div className="cta-actions">
            <a className="button button-primary button-lg" href={loginHref}>{chrome.signInDiscord}<Icon name="arrowRight" size={16} /></a>
            <a className="button button-secondary button-lg" href={invite}>{chrome.addToDiscord}</a>
          </div>
        </div>
      </section>

      <SiteFooter locale={locale}>
        <div className="footer-main">
          <p>{c.footer}</p>
          <nav aria-label={chrome.mainNav}>
            <a href="#features">{c.nav.features}</a>
            <a href="#security">{c.nav.security}</a>
            <a href="/dashboard">{chrome.dashboard}</a>
            <a href={invite}>{chrome.addToDiscord}</a>
          </nav>
        </div>
      </SiteFooter>
    </main>
  );
}
