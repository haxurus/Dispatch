'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';

type Role = {
  id: string;
  name: string;
  position: number;
};

type Binding = {
  id: string;
  discordRoleId: string;
  accessLevel: AccessLevel;
};

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

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Configurazione server</p>
          <h1>Permessi dashboard</h1>
          <p className="muted">Il tuo livello attuale: {access ?? '...'}</p>
        </div>
        <div className="actions">
          <a className="button" href={`/dashboard/${guildId}/tickets/manage`}>Gestisci ticket</a>
          <a className="button secondary" href={`/dashboard/${guildId}/forms`}>Form</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>Configura ticket</a>
          <a className="button secondary" href="/dashboard">Torna ai server</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {(access === 'ADMIN' || access === 'OWNER') ? (
        <section className="card">
          <h2>Ruoli Discord</h2>
          <p className="muted">
            Owner, Administrator e Manage Server ottengono accesso automaticamente. Qui puoi assegnare accesso agli altri ruoli.
          </p>

          {roles
            .filter((role) => role.id !== guildId)
            .map((role) => {
              const current = bindingMap.get(role.id) ?? '';
              return (
                <div className="role" key={role.id}>
                  <div>
                    <strong>{role.name}</strong>
                    <div className="muted">{role.id}</div>
                  </div>

                  <select
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

                  <span className="muted">{saving === role.id ? 'Salvataggio...' : ''}</span>
                </div>
              );
            })}
        </section>
      ) : (
        <section className="card">
          <h2>Accesso limitato</h2>
          <p>La gestione dei permessi richiede il livello Admin o Owner.</p>
        </section>
      )}
    </main>
  );
}
