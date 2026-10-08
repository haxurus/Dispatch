import { Icon } from './Brand';
import { SiteHeader } from './SiteChrome';
import { developmentCopy, type Locale } from '../i18n';

export default function DevelopmentNotice({ locale }: { locale: Locale }) {
  const c = developmentCopy[locale];
  return (
    <main className="public-site development-page" lang={locale}>
      <SiteHeader locale={locale} itHref="/it/development" enHref="/en/development" />
      <section className="development-hero">
        <div className="site-container development-card">
          <span className="kicker">{c.kicker}</span>
          <h1>{c.title}</h1>
          <p>{c.text}</p>
          <p>{c.detail}</p>
          <div className="development-actions">
            <a className="button button-primary button-lg" href="/dashboard">{c.dashboard}<Icon name="arrowRight" size={16} /></a>
          </div>
          <a className="development-home-link" href={`/${locale}`}><Icon name="arrowLeft" size={14} /> {c.home}</a>
        </div>
      </section>
    </main>
  );
}
