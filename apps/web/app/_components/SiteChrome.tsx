import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { LanguageSwitcher } from './LanguageSwitcher';
import { chromeCopy, type Locale } from '../i18n';

export type NavLink = { href: string; label: string; current?: boolean };

/**
 * Sticky site header. The language switcher is shown only when both mirror
 * URLs are given (the dashboard and the super console are Italian-only).
 */
export function SiteHeader({
  locale,
  links = [],
  itHref,
  enHref,
  homeHref,
  actions
}: {
  locale: Locale;
  links?: NavLink[];
  itHref?: string;
  enHref?: string;
  homeHref?: string;
  actions?: ReactNode;
}) {
  const c = chromeCopy[locale];
  const languages = itHref && enHref ? { itHref, enHref } : null;

  return (
    <header className="site-header">
      <div className="site-container site-nav">
        <Brand href={homeHref ?? `/${locale}`} label={c.homeLabel} />
        {links.length > 0 && (
          <nav className="site-nav-links" aria-label={c.mainNav}>
            {links.map((link) => (
              <a key={link.href} href={link.href} aria-current={link.current ? 'page' : undefined}>{link.label}</a>
            ))}
          </nav>
        )}
        <div className="site-nav-end">
          {languages && <LanguageSwitcher locale={locale} itHref={languages.itHref} enHref={languages.enHref} />}
          {actions && <div className="site-nav-actions">{actions}</div>}
        </div>
        {(links.length > 0 || actions || languages) && (
          <details className="site-mobile-menu">
            <summary aria-label={c.openMenu}><span /><span /></summary>
            <div>
              {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
              {languages && <LanguageSwitcher locale={locale} itHref={languages.itHref} enHref={languages.enHref} mobile />}
              {actions && <div className="site-mobile-actions">{actions}</div>}
            </div>
          </details>
        )}
      </div>
    </header>
  );
}

export function SiteFooter({ locale, children }: { locale: Locale; children?: ReactNode }) {
  const c = chromeCopy[locale];
  return (
    <footer className="site-footer">
      <div className="site-container">
        {children}
        <div className="site-footer-bottom">
          <span>Dispatch © 2026 · {c.madeBy} Haxurus</span>
          <span className="mono">{c.footerTag}</span>
        </div>
      </div>
    </footer>
  );
}
