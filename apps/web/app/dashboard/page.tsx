'use client';

import { useEffect, useState } from 'react';

type Me = {
  userId: string;
  username: string;
  avatarUrl: string | null;
};

type Guild = {
  guildId: string;
  guildName: string;
  access: 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
};

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      const meResponse = await fetch('/backend/api/me', { credentials: 'same-origin' });
      if (meResponse.status === 401) {
        window.location.href = '/backend/auth/discord';
        return;
      }
      if (!meResponse.ok) {
        setError('Impossibile caricare la sessione.');
        return;
      }

      setMe(await meResponse.json());

      const guildResponse = await fetch('/backend/api/guilds', { credentials: 'same-origin' });
      if (!guildResponse.ok) {
        setError('Impossibile caricare i server.');
        return;
      }
      setGuilds(await guildResponse.json());
    };

    void run();
  }, []);

  const logout = async () => {
    await fetch('/backend/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    });
    window.location.href = '/';
  };

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch</p>
          <h1>Dashboard</h1>
          <p className="muted">{me ? `Connesso come ${me.username}` : 'Caricamento sessione...'}</p>
        </div>
        <button className="secondary" onClick={logout}>Esci</button>
      </div>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>I tuoi server</h2>
        <div className="grid">
          {guilds.map((guild) => (
            <article className="card" key={guild.guildId}>
              <h3>{guild.guildName}</h3>
              <p className="muted">Accesso: {guild.access}</p>
              <a className="button" href={`/dashboard/${guild.guildId}`}>Gestisci</a>
            </article>
          ))}
        </div>
        {!error && me && guilds.length === 0 && (
          <p className="muted">Nessun server accessibile con Dispatch installato.</p>
        )}
      </section>
    </main>
  );
}
