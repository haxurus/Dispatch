'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Icon, type IconName } from '../../_components/Brand';

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

const sections = (guildId: string): Array<{ href: string; icon: IconName; title: string; text: string }> => [
  { href: `/dashboard/${guildId}/tickets/manage`, icon: 'inbox', title: 'Ticket', text: 'Coda dei ticket, filtri per stato, dettaglio, note e azioni dello staff.' },
  { href: `/dashboard/${guildId}/tickets`, icon: 'ticket', title: 'Configurazione ticket', text: 'Categorie, ruoli staff, questionari, SLA, automazioni e risposte rapide.' },
  { href: `/dashboard/${guildId}/tickets/system`, icon: 'sliders', title: 'Sistema e menu', text: 'Anti-spam globale, retention di transcript e canali, menu principale.' },
  { href: `/dashboard/${guildId}/panels`, icon: 'panel', title: 'Pannelli', text: 'Messaggi Discord per aprire ticket e form: menu o pulsanti, embed, emoji e anteprima.' },
  { href: `/dashboard/${guildId}/forms`, icon: 'clipboard', title: 'Form', text: 'Candidature e questionari con domande validate e permessi per ruolo.' },
  { href: `/dashboard/${guildId}/tickets/analytics`, icon: 'chart', title: 'Analytics', text: 'Volumi, tempi medi, violazioni SLA, feedback e attività dello staff.' },
  { href: `/dashboard/${guildId}/tickets/security`, icon: 'ban', title: 'Blacklist', text: 'Utenti esclusi dall’apertura di nuovi ticket, con scadenza e motivo.' }
];

const roleColor = (color: number | undefined) =>
  color ? `#${color.toString(16).padStart(6, '0')}` : undefined;

export default function GuildDashboardPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;

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
      setError('Non hai accesso a questo server oppure Discord non è raggiungibile.');
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
        setError('Impossibile aggiornare il permesso.');
        return;
      }

      await reload();
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
          <span className="kicker">Server</span>
          <h1>Panoramica</h1>
          <p>Scorciatoie alle sezioni del server e permessi di accesso alla dashboard.</p>
        </div>
        <div className="live-pill"><i />Accesso {access ? accessText[access] : '…'}</div>
      </header>

      <section className="content">
        {error && <div className="notice notice-error" role="alert">{error}</div>}

        <div className="quick-grid">
          {sections(guildId).map((section) => (
            <a className="quick-card" href={section.href} key={section.href}>
              <span className="feature-icon"><Icon name={section.icon} size={18} /></span>
              <strong>{section.title}</strong>
              <span>{section.text}</span>
            </a>
          ))}
        </div>

        {canAdmin ? (
          <div className="panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">Accessi</p>
                <h2>Permessi dashboard per ruolo</h2>
              </div>
              <span className="tag">{bindings.length} assegnati</span>
            </div>
            <p>
              Owner, Administrator e Manage Server ottengono accesso automaticamente. Qui puoi assegnare accesso agli altri ruoli.
            </p>

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
                      aria-label={`Accesso per ${role.name}`}
                      value={current}
                      disabled={saving === role.id}
                      onChange={(event) => {
                        void saveBinding(
                          role.id,
                          event.target.value as 'VIEWER' | 'MODERATOR' | 'ADMIN' | ''
                        );
                      }}
                    >
                      <option value="">Nessun accesso</option>
                      <option value="VIEWER">Viewer</option>
                      <option value="MODERATOR">Moderator</option>
                      <option value="ADMIN">Admin</option>
                    </select>

                    <em>{saving === role.id ? 'Salvataggio…' : ''}</em>
                  </div>
                );
              })}
              {assignableRoles.length === 0 && !error && <div className="empty">Caricamento ruoli…</div>}
            </div>
          </div>
        ) : (
          access && (
            <div className="notice">
              Accesso al pannello: <strong>{accessText[access]}</strong>. La gestione dei permessi richiede il livello Admin o Owner.
            </div>
          )
        )}
      </section>
    </>
  );
}
