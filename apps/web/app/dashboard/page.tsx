'use client';

import { useEffect, useState } from 'react';
import { Icon } from '../_components/Brand';
import { SiteFooter, SiteHeader } from '../_components/SiteChrome';
import { LocaleToggle, useCopy, useLocale } from '../_components/locale-context';
import { accessLabel, guildIconUrl, initial, logout, type DashboardGuild, type Me } from '../_components/session';
import { chromeCopy, inviteHref, loginHref, type Locale } from '../i18n';

type State = 'loading' | 'signed-out' | 'ready' | 'error';

const it = {
  sessionError: 'Impossibile caricare la sessione.',
  guildsError: 'Impossibile caricare i server.',
  networkError: 'Impossibile contattare il server. Riprova tra poco.',
  kicker: 'Dashboard',
  title: 'Gestisci Dispatch.',
  intro: 'Configura categorie, form, pannelli, SLA e permessi, e segui i ticket dei server che amministri.',
  signedInAs: 'Connesso come',
  sessionKicker: 'Sessione',
  checking: 'Verifica accesso in corso…',
  checkingText: 'Controllo la sessione Discord e i server associati al tuo account.',
  accessKicker: 'Accesso',
  signInTitle: 'Entra con il tuo account Discord.',
  signInText: 'Accedi con Discord per vedere e amministrare i server in cui Dispatch è installato.',
  newServerKicker: 'Nuovo server',
  newServerTitle: 'Dispatch non è ancora nel server?',
  newServerText: 'Aggiungilo prima, poi torna qui e accedi con Discord per completare la configurazione.',
  serversKicker: 'Server',
  serversTitle: 'Scegli cosa amministrare',
  addToServer: 'Aggiungi a un server',
  noServers: 'Nessun server accessibile con Dispatch installato. Aggiungi il bot a un server oppure verifica i tuoi permessi Discord.'
};

const en: typeof it = {
  sessionError: 'The session could not be loaded.',
  guildsError: 'The servers could not be loaded.',
  networkError: 'The server could not be reached. Try again shortly.',
  kicker: 'Dashboard',
  title: 'Manage Dispatch.',
  intro: 'Set up categories, forms, panels, SLAs and permissions, and follow the tickets of the servers you manage.',
  signedInAs: 'Signed in as',
  sessionKicker: 'Session',
  checking: 'Checking access…',
  checkingText: 'Checking your Discord session and the servers linked to your account.',
  accessKicker: 'Sign in',
  signInTitle: 'Sign in with your Discord account.',
  signInText: 'Sign in with Discord to see and manage the servers where Dispatch is installed.',
  newServerKicker: 'New server',
  newServerTitle: 'Dispatch is not in your server yet?',
  newServerText: 'Add it first, then come back here and sign in with Discord to finish the setup.',
  serversKicker: 'Servers',
  serversTitle: 'Choose what to manage',
  addToServer: 'Add to a server',
  noServers: 'No accessible server with Dispatch installed. Add the bot to a server or check your Discord permissions.'
};

const copy: Record<Locale, typeof it> = { it, en };

export default function DashboardPage() {
  const locale = useLocale();
  const c = useCopy(copy);
  const chrome = chromeCopy[locale];
  const [me, setMe] = useState<Me | null>(null);
  const [guilds, setGuilds] = useState<DashboardGuild[]>([]);
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      const meResponse = await fetch('/backend/api/me', { credentials: 'same-origin' });
      if (meResponse.status === 401) {
        setState('signed-out');
        return;
      }
      if (!meResponse.ok) {
        setError(c.sessionError);
        setState('error');
        return;
      }

      setMe(await meResponse.json());

      const guildResponse = await fetch('/backend/api/guilds', { credentials: 'same-origin' });
      if (!guildResponse.ok) {
        setError(c.guildsError);
        setState('error');
        return;
      }
      setGuilds(await guildResponse.json());
      setState('ready');
    };

    run().catch(() => {
      setError(c.networkError);
      setState('error');
    });
  }, [c]);

  const invite = inviteHref(locale);

  return (
    <main className="public-site dashboard-landing" lang={locale}>
      <SiteHeader
        locale={locale}
        homeHref={`/${locale}`}
        links={[
          { href: `/${locale}`, label: 'Home' },
          { href: '/dashboard', label: chrome.dashboard, current: true },
          ...(me?.superAdmin ? [{ href: '/super', label: chrome.superConsole }] : [])
        ]}
        actions={<>
          <LocaleToggle />
          {me && <button type="button" className="button button-ghost" onClick={() => void logout()}><Icon name="logout" size={15} />{chrome.logout}</button>}
          <a className="button button-primary" href={invite}>{chrome.addToDiscord}</a>
        </>}
      />

      <section className="page">
        <div className="site-container">
          <div className="page-head">
            <div>
              <span className="kicker">{c.kicker}</span>
              <h1>{c.title}</h1>
              <p>{c.intro}</p>
            </div>
            {me && (
              <div className="user-card">
                {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : <div className="avatar-fallback">{initial(me.username)}</div>}
                <div><span>{c.signedInAs}</span><strong>{me.username}</strong></div>
              </div>
            )}
          </div>

          {state === 'loading' && (
            <div className="card skeleton-card">
              <span className="kicker">{c.sessionKicker}</span>
              <h2>{c.checking}</h2>
              <p>{c.checkingText}</p>
            </div>
          )}

          {state === 'signed-out' && (
            <div className="auth-grid">
              <div className="card card-feature">
                <span className="kicker">{c.accessKicker}</span>
                <h2>{c.signInTitle}</h2>
                <p>{c.signInText}</p>
                <a className="button button-primary button-lg" href={loginHref}>{chrome.signInDiscord}<Icon name="arrowRight" size={16} /></a>
              </div>
              <div className="card">
                <span className="kicker">{c.newServerKicker}</span>
                <h2>{c.newServerTitle}</h2>
                <p>{c.newServerText}</p>
                <a className="button button-secondary button-lg" href={invite}>{chrome.addToDiscord}</a>
              </div>
            </div>
          )}

          {state === 'error' && <div className="notice notice-error">{error}</div>}

          {state === 'ready' && (
            <div className="card">
              <div className="card-head">
                <div><span className="kicker">{c.serversKicker}</span><h2>{c.serversTitle}</h2></div>
                <a className="button button-secondary" href={invite}><Icon name="plus" size={16} />{c.addToServer}</a>
              </div>
              {guilds.length === 0 && <div className="notice">{c.noServers}</div>}
              <div className="guild-grid">
                {guilds.map((guild) => {
                  const icon = guildIconUrl(guild.guildId, guild.oauth?.icon);
                  return (
                    <a className="guild-card" href={`/dashboard/${guild.guildId}`} key={guild.guildId}>
                      {icon ? <img src={icon} alt="" /> : <div className="guild-placeholder">{initial(guild.guildName)}</div>}
                      <div>
                        <strong>{guild.guildName}</strong>
                        <span className={guild.access === 'OWNER' || guild.access === 'ADMIN' ? 'tag tag-accent' : 'tag'}>
                          {guild.access ? accessLabel[guild.access] : '—'}
                        </span>
                      </div>
                      <Icon name="arrowRight" size={18} />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      <SiteFooter locale={locale} />
    </main>
  );
}
