'use client';

import { useEffect, useState } from 'react';
import { Icon } from '../_components/Brand';
import { SiteFooter, SiteHeader } from '../_components/SiteChrome';
import { accessLabel, guildIconUrl, initial, logout, type DashboardGuild, type Me } from '../_components/session';
import { inviteHref, loginHref } from '../i18n';

type State = 'loading' | 'signed-out' | 'ready' | 'error';

export default function DashboardPage() {
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
        setError('Impossibile caricare la sessione.');
        setState('error');
        return;
      }

      setMe(await meResponse.json());

      const guildResponse = await fetch('/backend/api/guilds', { credentials: 'same-origin' });
      if (!guildResponse.ok) {
        setError('Impossibile caricare i server.');
        setState('error');
        return;
      }
      setGuilds(await guildResponse.json());
      setState('ready');
    };

    run().catch(() => {
      setError('Impossibile contattare il server. Riprova tra poco.');
      setState('error');
    });
  }, []);

  const invite = inviteHref('it');

  return (
    <main className="public-site dashboard-landing" lang="it">
      <SiteHeader
        locale="it"
        homeHref="/it"
        links={[
          { href: '/it', label: 'Home' },
          { href: '/dashboard', label: 'Dashboard', current: true },
          ...(me?.superAdmin ? [{ href: '/super', label: 'Super console' }] : [])
        ]}
        actions={<>
          {me && <button type="button" className="button button-ghost" onClick={() => void logout()}><Icon name="logout" size={15} />Esci</button>}
          <a className="button button-primary" href={invite}>Aggiungi a Discord</a>
        </>}
      />

      <section className="page">
        <div className="site-container">
          <div className="page-head">
            <div>
              <span className="kicker">Dashboard</span>
              <h1>Gestisci Dispatch.</h1>
              <p>Configura categorie, form, pannelli, SLA e permessi, e segui i ticket dei server che amministri.</p>
            </div>
            {me && (
              <div className="user-card">
                {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : <div className="avatar-fallback">{initial(me.username)}</div>}
                <div><span>Connesso come</span><strong>{me.username}</strong></div>
              </div>
            )}
          </div>

          {state === 'loading' && (
            <div className="card skeleton-card">
              <span className="kicker">Sessione</span>
              <h2>Verifica accesso in corso…</h2>
              <p>Controllo la sessione Discord e i server associati al tuo account.</p>
            </div>
          )}

          {state === 'signed-out' && (
            <div className="auth-grid">
              <div className="card card-feature">
                <span className="kicker">Accesso</span>
                <h2>Entra con il tuo account Discord.</h2>
                <p>Accedi con Discord per vedere e amministrare i server in cui Dispatch è installato.</p>
                <a className="button button-primary button-lg" href={loginHref}>Accedi con Discord<Icon name="arrowRight" size={16} /></a>
              </div>
              <div className="card">
                <span className="kicker">Nuovo server</span>
                <h2>Dispatch non è ancora nel server?</h2>
                <p>Aggiungilo prima, poi torna qui e accedi con Discord per completare la configurazione.</p>
                <a className="button button-secondary button-lg" href={invite}>Aggiungi a Discord</a>
              </div>
            </div>
          )}

          {state === 'error' && <div className="notice notice-error">{error}</div>}

          {state === 'ready' && (
            <div className="card">
              <div className="card-head">
                <div><span className="kicker">Server</span><h2>Scegli cosa amministrare</h2></div>
                <a className="button button-secondary" href={invite}><Icon name="plus" size={16} />Aggiungi a un server</a>
              </div>
              {guilds.length === 0 && (
                <div className="notice">Nessun server accessibile con Dispatch installato. Aggiungi il bot a un server oppure verifica i tuoi permessi Discord.</div>
              )}
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

      <SiteFooter locale="it" />
    </main>
  );
}
