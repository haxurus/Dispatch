'use client';

import { FormEvent, useEffect, useState, type CSSProperties } from 'react';
import ResourcePicker, { CHANNEL_TYPES, type PickerChannel } from './ResourcePicker';
import { useCopy } from './locale-context';
import { PlanBadge, apiErrorText, planHas, usePlan } from './plan-client';
import { format, type Locale } from '../i18n';

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

const MEDALS = ['🥇', '🥈', '🥉'];

const it = {
  weekdays: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
  errors: {
    INVALID_BODY: 'Controlla i valori: un canale è obbligatorio se la pubblicazione settimanale o mensile è attiva.',
    LEADERBOARD_CHANNEL_NOT_FOUND: 'Il canale selezionato non è un canale testuale o di annunci del server.',
    LEADERBOARD_CHANNEL_REQUIRED: 'Seleziona e salva un canale prima di inviare la classifica.',
    LEADERBOARD_CHANNEL_INVALID: 'Il canale non esiste più oppure non è un canale testuale o di annunci di questo server.',
    LEADERBOARD_SEND_FAILED: 'Discord ha rifiutato il messaggio: controlla che il bot possa vedere il canale, scrivere e inviare embed.',
    GUILD_NOT_FOUND: 'Il bot non è presente nel server.',
    PLAN_REQUIRED: 'La pubblicazione della classifica richiede il piano {plan} o superiore.'
  } as Record<string, string>,
  planNote: 'La pubblicazione della classifica è inclusa dal piano Pro: puoi salvare le impostazioni, ma il bot pubblicherà la classifica (e “Invia ora” funzionerà) solo dopo l’upgrade.',
  minuteUnit: 'min',
  hourUnit: 'h',
  dayUnit: 'g',
  previewError: 'Impossibile calcolare la classifica.',
  settingsLoadError: 'Impossibile caricare le impostazioni della classifica.',
  saveFailed: 'Salvataggio fallito: {code}',
  sendFailed: 'Invio fallito: {code}',
  saved: 'Impostazioni della classifica salvate.',
  sent: 'Classifica inviata nel canale configurato.',
  title: 'Classifica moderatori',
  previewSubtitle: '{title}{progress} · fuso orario {timeZone}',
  inProgress: ' (in corso)',
  intro: 'Ticket gestiti, valutazioni e tempi di prima risposta per moderatore.',
  week: 'Settimana',
  month: 'Mese',
  currentWeek: 'Settimana corrente',
  currentMonth: 'Mese corrente',
  previousWeek: 'Settimana precedente',
  previousMonth: 'Mese precedente',
  colModerator: 'Moderatore',
  colHandled: 'Ticket gestiti',
  colRating: 'Valutazione',
  colFeedback: 'Feedback',
  colFirstResponse: '1ª risposta (mediana)',
  colClaims: 'Claim',
  empty: 'Nessun ticket gestito in questo periodo.',
  ordering: 'Ordine: ticket gestiti (chiusi nel periodo e attribuiti a chi li aveva in carico, altrimenti a chi li ha chiusi), poi valutazione media, mostrata solo con almeno {minRatings} valutazioni, poi numero di valutazioni. Primi {size} moderatori.',
  publishTitle: 'Pubblicazione della classifica',
  publishIntro: 'Il bot pubblica la classifica del periodo concluso nel canale scelto, menzionando i moderatori senza notificarli. Orari nel fuso del server ({timeZone}).',
  weekly: 'Settimanale',
  monthly: 'Mensile',
  disabled: 'Disattivata',
  channelLabel: 'Canale classifica',
  channelPlaceholder: 'Nessun canale (pubblicazione disattivata)',
  channelHint: 'Canale testuale o di annunci. Il bot deve poter vedere il canale, scrivere e inviare embed.',
  weeklyLeaderboard: 'Classifica settimanale',
  monthlyLeaderboard: 'Classifica mensile (il giorno 1)',
  weekdayLabel: 'Giorno (settimanale)',
  hourLabel: 'Ora',
  sizeLabel: 'Moderatori mostrati',
  minRatingsLabel: 'Valutazioni minime per la media',
  lastPublished: 'Ultima settimana pubblicata: {week} · ultimo mese pubblicato: {month}. “Invia ora” pubblica il periodo selezionato sopra senza modificare la pianificazione.',
  noWeek: 'nessuna',
  noMonth: 'nessuno',
  saving: 'Salvataggio...',
  save: 'Salva impostazioni',
  sending: 'Invio...',
  sendNow: 'Invia ora'
};

const en: typeof it = {
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  errors: {
    INVALID_BODY: 'Check the values: a channel is required when weekly or monthly publishing is on.',
    LEADERBOARD_CHANNEL_NOT_FOUND: 'The selected channel is not a text or announcement channel of the server.',
    LEADERBOARD_CHANNEL_REQUIRED: 'Select and save a channel before sending the leaderboard.',
    LEADERBOARD_CHANNEL_INVALID: 'The channel no longer exists or is not a text or announcement channel of this server.',
    LEADERBOARD_SEND_FAILED: 'Discord rejected the message: check that the bot can view the channel, send messages and embed links.',
    GUILD_NOT_FOUND: 'The bot is not in the server.',
    PLAN_REQUIRED: 'Publishing the leaderboard requires the {plan} plan or higher.'
  },
  planNote: 'Leaderboard publishing is included from the Pro plan: you can save the settings, but the bot will post the leaderboard (and “Send now” will work) only after upgrading.',
  minuteUnit: 'min',
  hourUnit: 'h',
  dayUnit: 'd',
  previewError: 'The leaderboard could not be calculated.',
  settingsLoadError: 'The leaderboard settings could not be loaded.',
  saveFailed: 'Save failed: {code}',
  sendFailed: 'Send failed: {code}',
  saved: 'Leaderboard settings saved.',
  sent: 'Leaderboard sent to the configured channel.',
  title: 'Moderator leaderboard',
  previewSubtitle: '{title}{progress} · time zone {timeZone}',
  inProgress: ' (in progress)',
  intro: 'Tickets handled, ratings and first response times per moderator.',
  week: 'Week',
  month: 'Month',
  currentWeek: 'Current week',
  currentMonth: 'Current month',
  previousWeek: 'Previous week',
  previousMonth: 'Previous month',
  colModerator: 'Moderator',
  colHandled: 'Tickets handled',
  colRating: 'Rating',
  colFeedback: 'Feedback',
  colFirstResponse: '1st response (median)',
  colClaims: 'Claims',
  empty: 'No tickets handled in this period.',
  ordering: 'Order: tickets handled (closed in the period and credited to whoever had claimed them, otherwise to whoever closed them), then average rating, shown only with at least {minRatings} ratings, then number of ratings. Top {size} moderators.',
  publishTitle: 'Leaderboard publishing',
  publishIntro: 'The bot posts the leaderboard for the completed period in the chosen channel, mentioning moderators without notifying them. Times use the server time zone ({timeZone}).',
  weekly: 'Weekly',
  monthly: 'Monthly',
  disabled: 'Off',
  channelLabel: 'Leaderboard channel',
  channelPlaceholder: 'No channel (publishing off)',
  channelHint: 'Text or announcement channel. The bot must be able to view the channel, send messages and embed links.',
  weeklyLeaderboard: 'Weekly leaderboard',
  monthlyLeaderboard: 'Monthly leaderboard (on the 1st)',
  weekdayLabel: 'Day (weekly)',
  hourLabel: 'Hour',
  sizeLabel: 'Moderators shown',
  minRatingsLabel: 'Minimum ratings for the average',
  lastPublished: 'Last week published: {week} · last month published: {month}. “Send now” posts the period selected above without changing the schedule.',
  noWeek: 'none',
  noMonth: 'none',
  saving: 'Saving...',
  save: 'Save settings',
  sending: 'Sending...',
  sendNow: 'Send now'
};

const copy: Record<Locale, typeof it> = { it, en };

// Mirror of formatLeaderboardMinutes in @dispatch/shared (the web app does not depend on it).
function duration(minutes: number | null, c: typeof it) {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  if (minutes < 1) return `<1 ${c.minuteUnit}`;
  if (minutes < 60) return `${Math.round(minutes)} ${c.minuteUnit}`;
  const total = Math.round(minutes);
  if (total < 24 * 60) return `${Math.floor(total / 60)} ${c.hourUnit} ${String(total % 60).padStart(2, '0')} ${c.minuteUnit}`;
  const hours = Math.floor(total / 60);
  return `${Math.floor(hours / 24)} ${c.dayUnit} ${hours % 24} ${c.hourUnit}`;
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
  const c = useCopy(copy);
  const { plan } = usePlan(guildId);
  // false only once the plan is known and lacks the leaderboard.
  const leaderboardLocked = planHas(plan, 'leaderboard') === false;
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
        setPreviewError(c.previewError);
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
        setError(c.settingsLoadError);
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
      setError(apiErrorText(c.errors, body, format(c.saveFailed, { code: body.error ?? response.status })));
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
      if (await putSettings(settings)) setNotice(c.saved);
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
        setError(apiErrorText(c.errors, body, format(c.sendFailed, { code: body.error ?? response.status })));
        return;
      }
      setNotice(c.sent);
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
            <h2>{c.title}</h2>
            <p className="muted">
              {preview
                ? format(c.previewSubtitle, {
                  title: preview.period.title,
                  progress: preview.period.inProgress ? c.inProgress : '',
                  timeZone: preview.period.timeZone
                })
                : c.intro}
            </p>
          </div>
          <div className="actions">
            <select value={kind} onChange={(event) => setKind(event.target.value === 'month' ? 'month' : 'week')}>
              <option value="week">{c.week}</option>
              <option value="month">{c.month}</option>
            </select>
            <select value={offset} onChange={(event) => setOffset(Number(event.target.value))}>
              <option value={0}>{kind === 'week' ? c.currentWeek : c.currentMonth}</option>
              <option value={1}>{kind === 'week' ? c.previousWeek : c.previousMonth}</option>
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
                  <th>{c.colModerator}</th>
                  <th>{c.colHandled}</th>
                  <th>{c.colRating}</th>
                  <th>{c.colFeedback}</th>
                  <th>{c.colFirstResponse}</th>
                  <th>{c.colClaims}</th>
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
                    <td>{duration(entry.medianFirstResponseMinutes, c)}</td>
                    <td>{entry.claims}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{c.empty}</p>
        ))}

        {preview && (
          <p className="muted">
            {format(c.ordering, { minRatings: preview.minRatings, size: preview.size })}
          </p>
        )}
      </section>

      {isAdmin && settings && (
        <form className="card form" onSubmit={save}>
          <div className="row">
            <div>
              <h2 className="plan-heading">{c.publishTitle}{leaderboardLocked && <PlanBadge required="TIER2" />}</h2>
              <p className="muted">
                {format(c.publishIntro, { timeZone: meta?.timezone ?? 'Europe/Rome' })}
              </p>
            </div>
            <span className="badge">
              {settings.leaderboardChannelId && (settings.leaderboardWeekly || settings.leaderboardMonthly)
                ? [settings.leaderboardWeekly ? c.weekly : null, settings.leaderboardMonthly ? c.monthly : null].filter(Boolean).join(' + ')
                : c.disabled}
            </span>
          </div>

          {leaderboardLocked && <p className="plan-hint"><span>{c.planNote}</span></p>}
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}

          <ResourcePicker
            label={c.channelLabel}
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
            placeholder={c.channelPlaceholder}
            hint={c.channelHint}
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
              {c.weeklyLeaderboard}
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.leaderboardMonthly}
                onChange={(event) => setSettings({ ...settings, leaderboardMonthly: event.target.checked })}
              />
              {c.monthlyLeaderboard}
            </label>
          </div>

          <div className="field-row" style={{ '--cols': 4 } as CSSProperties}>
            <label>
              {c.weekdayLabel}
              <select
                value={settings.leaderboardWeekday}
                onChange={(event) => setSettings({ ...settings, leaderboardWeekday: Number(event.target.value) })}
              >
                {c.weekdays.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
              </select>
            </label>
            <label>
              {c.hourLabel}
              <select
                value={settings.leaderboardHour}
                onChange={(event) => setSettings({ ...settings, leaderboardHour: Number(event.target.value) })}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>
                ))}
              </select>
            </label>
            {numberInput('leaderboardSize', c.sizeLabel, 3, 25)}
            {numberInput('leaderboardMinRatings', c.minRatingsLabel, 0, 50)}
          </div>

          <p className="muted">
            {format(c.lastPublished, {
              week: meta?.leaderboardLastWeekly ?? c.noWeek,
              month: meta?.leaderboardLastMonthly ?? c.noMonth
            })}
          </p>

          <div className="actions">
            <button disabled={Boolean(busy)} type="submit">
              {busy === 'save' ? c.saving : c.save}
            </button>
            <button
              disabled={Boolean(busy) || !settings.leaderboardChannelId || leaderboardLocked}
              title={leaderboardLocked ? c.planNote : undefined}
              type="button"
              className="secondary"
              onClick={() => void sendNow()}
            >
              {busy === 'send' ? c.sending : c.sendNow}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
