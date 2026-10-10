'use client';

import { FormEvent, useEffect, useState, type CSSProperties } from 'react';
import ResourcePicker, { CHANNEL_TYPES, type PickerChannel } from './ResourcePicker';

/*
 * "Classifica moderatori" (Analytics page): preview of the current or previous
 * week/month for Moderator+, schedule settings and "Invia ora" for Admin/Owner.
 * Ranking and periods are computed by the API with @dispatch/shared.
 */

type Kind = 'week' | 'month';

type Entry = {
  rank: number;
  userId: string;
  handled: number;
  feedbackCount: number;
  averageRating: number | null;
  firstResponses: number;
  medianFirstResponseMinutes: number | null;
  claims: number;
};

type Preview = {
  period: {
    kind: Kind;
    key: string;
    label: string;
    title: string;
    start: string;
    end: string;
    timeZone: string;
    offset: number;
    inProgress: boolean;
  };
  minRatings: number;
  size: number;
  entries: Entry[];
};

type Settings = {
  leaderboardChannelId: string | null;
  leaderboardWeekly: boolean;
  leaderboardMonthly: boolean;
  leaderboardSize: number;
  leaderboardMinRatings: number;
  leaderboardWeekday: number;
  leaderboardHour: number;
};

type SettingsResponse = Settings & {
  timezone: string;
  leaderboardLastWeekly: string | null;
  leaderboardLastMonthly: string | null;
};

const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const MEDALS = ['🥇', '🥈', '🥉'];

const errorMessages: Record<string, string> = {
  INVALID_BODY: 'Controlla i valori: un canale è obbligatorio se la pubblicazione settimanale o mensile è attiva.',
  LEADERBOARD_CHANNEL_NOT_FOUND: 'Il canale selezionato non è un canale testuale o di annunci del server.',
  LEADERBOARD_CHANNEL_REQUIRED: 'Seleziona e salva un canale prima di inviare la classifica.',
  LEADERBOARD_CHANNEL_INVALID: 'Il canale non esiste più oppure non è un canale testuale o di annunci di questo server.',
  LEADERBOARD_SEND_FAILED: 'Discord ha rifiutato il messaggio: controlla che il bot possa vedere il canale, scrivere e inviare embed.',
  GUILD_NOT_FOUND: 'Il bot non è presente nel server.'
};

// Mirror of formatLeaderboardMinutes in @dispatch/shared (the web app does not depend on it).
function duration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const total = Math.round(minutes);
  if (total < 24 * 60) return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
  const hours = Math.floor(total / 60);
  return `${Math.floor(hours / 24)} g ${hours % 24} h`;
}

function settingsBody(settings: Settings): Settings {
  return {
    leaderboardChannelId: settings.leaderboardChannelId,
    leaderboardWeekly: settings.leaderboardWeekly,
    leaderboardMonthly: settings.leaderboardMonthly,
    leaderboardSize: settings.leaderboardSize,
    leaderboardMinRatings: settings.leaderboardMinRatings,
    leaderboardWeekday: settings.leaderboardWeekday,
    leaderboardHour: settings.leaderboardHour
  };
}

export default function ModeratorLeaderboard({ guildId }: { guildId: string }) {
  const [kind, setKind] = useState<Kind>('week');
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');

  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [meta, setMeta] = useState<Pick<SettingsResponse, 'timezone' | 'leaderboardLastWeekly' | 'leaderboardLastMonthly'> | null>(null);
  const [channels, setChannels] = useState<PickerChannel[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPreviewError('');
    void (async () => {
      const response = await fetch(`/backend/api/guilds/${guildId}/leaderboard?period=${kind}&offset=${offset}`);
      if (cancelled) return;
      if (!response.ok) {
        setPreview(null);
        setPreviewError('Impossibile calcolare la classifica.');
        return;
      }
      const body = await response.json() as Preview;
      if (!cancelled) setPreview(body);
    })();
    return () => { cancelled = true; };
  }, [guildId, kind, offset]);

  const applySettings = (body: SettingsResponse) => {
    const { timezone, leaderboardLastWeekly, leaderboardLastMonthly, ...rest } = body;
    setMeta({ timezone, leaderboardLastWeekly, leaderboardLastMonthly });
    setSettings(settingsBody(rest));
  };

  useEffect(() => {
    void (async () => {
      const accessResponse = await fetch(`/backend/api/guilds/${guildId}/access`);
      if (!accessResponse.ok) return;
      const { access } = await accessResponse.json() as { access: string };
      if (access !== 'ADMIN' && access !== 'OWNER') return;
      setIsAdmin(true);
      const [settingsResponse, resourcesResponse] = await Promise.all([
        fetch(`/backend/api/guilds/${guildId}/leaderboard/settings`),
        fetch(`/backend/api/guilds/${guildId}/resources`)
      ]);
      if (!settingsResponse.ok) {
        setError('Impossibile caricare le impostazioni della classifica.');
        return;
      }
      applySettings(await settingsResponse.json() as SettingsResponse);
      if (resourcesResponse.ok) setChannels((await resourcesResponse.json()).channels ?? []);
    })();
  }, [guildId]);

  const putSettings = async (current: Settings) => {
    const response = await fetch(`/backend/api/guilds/${guildId}/leaderboard/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsBody(current))
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(errorMessages[body.error] ?? `Salvataggio fallito: ${body.error ?? response.status}`);
      return false;
    }
    applySettings(await response.json() as SettingsResponse);
    return true;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setBusy('save');
    setError('');
    setNotice('');
    try {
      if (await putSettings(settings)) setNotice('Impostazioni della classifica salvate.');
    } finally {
      setBusy('');
    }
  };

  // Saves first, then posts exactly the period shown in the preview.
  const sendNow = async () => {
    if (!settings) return;
    setBusy('send');
    setError('');
    setNotice('');
    try {
      if (!(await putSettings(settings))) return;
      const response = await fetch(`/backend/api/guilds/${guildId}/leaderboard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: kind, offset })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(errorMessages[body.error] ?? `Invio fallito: ${body.error ?? response.status}`);
        return;
      }
      setNotice('Classifica inviata nel canale configurato.');
    } finally {
      setBusy('');
    }
  };

  const numberInput = (key: 'leaderboardSize' | 'leaderboardMinRatings', label: string, min: number, max: number) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={settings?.[key] ?? min}
        onChange={(event) => {
          if (!settings) return;
          const value = Number(event.target.value);
          setSettings(key === 'leaderboardSize'
            ? { ...settings, leaderboardSize: value }
            : { ...settings, leaderboardMinRatings: value });
        }}
      />
    </label>
  );

  return (
    <>
      <section className="card">
        <div className="row">
          <div>
            <h2>Classifica moderatori</h2>
            <p className="muted">
              {preview
                ? `${preview.period.title}${preview.period.inProgress ? ' (in corso)' : ''} · fuso orario ${preview.period.timeZone}`
                : 'Ticket gestiti, valutazioni e tempi di prima risposta per moderatore.'}
            </p>
          </div>
          <div className="actions">
            <select value={kind} onChange={(event) => setKind(event.target.value === 'month' ? 'month' : 'week')}>
              <option value="week">Settimana</option>
              <option value="month">Mese</option>
            </select>
            <select value={offset} onChange={(event) => setOffset(Number(event.target.value))}>
              <option value={0}>{kind === 'week' ? 'Settimana corrente' : 'Mese corrente'}</option>
              <option value={1}>{kind === 'week' ? 'Settimana precedente' : 'Mese precedente'}</option>
            </select>
          </div>
        </div>

        {previewError && <p className="error">{previewError}</p>}

        {preview && (preview.entries.some((entry) => entry.handled > 0) ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Moderatore</th>
                  <th>Ticket gestiti</th>
                  <th>Valutazione</th>
                  <th>Feedback</th>
                  <th>1ª risposta (mediana)</th>
                  <th>Claim</th>
                </tr>
              </thead>
              <tbody>
                {preview.entries.map((entry) => (
                  <tr key={entry.userId}>
                    <td>{entry.rank <= 3 ? MEDALS[entry.rank - 1] : entry.rank}</td>
                    <td className="mono">{entry.userId}</td>
                    <td>{entry.handled}</td>
                    <td>{entry.averageRating === null ? '—' : `${entry.averageRating.toFixed(2)}/5`}</td>
                    <td>{entry.feedbackCount}</td>
                    <td>{duration(entry.medianFirstResponseMinutes)}</td>
                    <td>{entry.claims}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Nessun ticket gestito in questo periodo.</p>
        ))}

        {preview && (
          <p className="muted">
            Ordine: ticket gestiti (chiusi nel periodo e attribuiti a chi li aveva in carico, altrimenti a chi li ha
            chiusi), poi valutazione media, mostrata solo con almeno {preview.minRatings} valutazioni, poi numero di
            valutazioni. Primi {preview.size} moderatori.
          </p>
        )}
      </section>

      {isAdmin && settings && (
        <form className="card form" onSubmit={save}>
          <div className="row">
            <div>
              <h2>Pubblicazione della classifica</h2>
              <p className="muted">
                Il bot pubblica la classifica del periodo concluso nel canale scelto, menzionando i moderatori senza
                notificarli. Orari nel fuso del server ({meta?.timezone ?? 'Europe/Rome'}).
              </p>
            </div>
            <span className="badge">
              {settings.leaderboardChannelId && (settings.leaderboardWeekly || settings.leaderboardMonthly)
                ? [settings.leaderboardWeekly ? 'Settimanale' : null, settings.leaderboardMonthly ? 'Mensile' : null].filter(Boolean).join(' + ')
                : 'Disattivata'}
            </span>
          </div>

          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}

          <ResourcePicker
            label="Canale classifica"
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
            placeholder="Nessun canale (pubblicazione disattivata)"
            hint="Canale testuale o di annunci. Il bot deve poter vedere il canale, scrivere e inviare embed."
            value={settings.leaderboardChannelId ?? ''}
            onChange={(channelId) => setSettings({ ...settings, leaderboardChannelId: channelId || null })}
          />

          <div className="field-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.leaderboardWeekly}
                onChange={(event) => setSettings({ ...settings, leaderboardWeekly: event.target.checked })}
              />
              Classifica settimanale
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.leaderboardMonthly}
                onChange={(event) => setSettings({ ...settings, leaderboardMonthly: event.target.checked })}
              />
              Classifica mensile (il giorno 1)
            </label>
          </div>

          <div className="field-row" style={{ '--cols': 4 } as CSSProperties}>
            <label>
              Giorno (settimanale)
              <select
                value={settings.leaderboardWeekday}
                onChange={(event) => setSettings({ ...settings, leaderboardWeekday: Number(event.target.value) })}
              >
                {WEEKDAYS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
              </select>
            </label>
            <label>
              Ora
              <select
                value={settings.leaderboardHour}
                onChange={(event) => setSettings({ ...settings, leaderboardHour: Number(event.target.value) })}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>
                ))}
              </select>
            </label>
            {numberInput('leaderboardSize', 'Moderatori mostrati', 3, 25)}
            {numberInput('leaderboardMinRatings', 'Valutazioni minime per la media', 0, 50)}
          </div>

          <p className="muted">
            Ultima settimana pubblicata: {meta?.leaderboardLastWeekly ?? 'nessuna'} · ultimo mese pubblicato:{' '}
            {meta?.leaderboardLastMonthly ?? 'nessuno'}. “Invia ora” pubblica il periodo selezionato sopra senza
            modificare la pianificazione.
          </p>

          <div className="actions">
            <button disabled={Boolean(busy)} type="submit">
              {busy === 'save' ? 'Salvataggio...' : 'Salva impostazioni'}
            </button>
            <button
              disabled={Boolean(busy) || !settings.leaderboardChannelId}
              type="button"
              className="secondary"
              onClick={() => void sendNow()}
            >
              {busy === 'send' ? 'Invio...' : 'Invia ora'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
