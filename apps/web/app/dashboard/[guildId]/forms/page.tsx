'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
type Channel = { id: string; name: string; type: number };
type Role = { id: string; name: string; position: number };
type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'INTEGER' | 'NUMBER' | 'EMAIL' | 'URL' | 'DATE' | 'BOOLEAN' | 'SINGLE_SELECT' | 'MULTI_SELECT' | 'DISCORD_ID';
type Option = { label: string; value: string; description: string | null };
type Question = {
  id: string; label: string; description: string | null; type: QuestionType; required: boolean;
  placeholder: string | null; minLength: number | null; maxLength: number | null;
  minValue: number | null; maxValue: number | null; minSelections: number | null; maxSelections: number | null;
  options: Option[];
};
type FormDef = {
  id: string; name: string; description: string | null; questions: Question[]; enabled: boolean;
  openAt: string | null; closeAt: string | null; deliveryMode: 'EPHEMERAL' | 'DM';
  resultChannelId: string | null; resultRoleIds: string[]; allowedRoleIds: string[]; deniedRoleIds: string[];
  maxSubmissionsPerUser: number; cooldownSeconds: number; submissionWindowMinutes: number; maxAttemptsPerWindow: number;
  createTicketOnSubmit: boolean; ticketCategoryId: string | null; ticketParentCategoryId: string | null;
  ticketStaffRoleIds: string[]; ticketPrefix: string;
};
type Panel = {
  id: string; formId: string; channelId: string; messageId: string | null; title: string;
  description: string | null; buttonLabel: string; enabled: boolean; form?: { name: string };
};
type Permission = {
  id: string; discordRoleId: string; canManage: boolean; canView: boolean; canReview: boolean; canSubmit: boolean;
};

const emptyQuestion = (index: number): Question => ({
  id: `q${index}`, label: '', description: null, type: 'SHORT_TEXT', required: true,
  placeholder: null, minLength: null, maxLength: 1000, minValue: null, maxValue: null,
  minSelections: null, maxSelections: null, options: []
});

const emptyForm = () => ({
  name: '', description: '', questions: [emptyQuestion(1)], enabled: true,
  openAt: '', closeAt: '', deliveryMode: 'EPHEMERAL' as const, resultChannelId: '',
  resultRoleIds: [] as string[], allowedRoleIds: [] as string[], deniedRoleIds: [] as string[],
  maxSubmissionsPerUser: 1, cooldownSeconds: 300, submissionWindowMinutes: 60, maxAttemptsPerWindow: 5,
  createTicketOnSubmit: false, ticketCategoryId: '', ticketParentCategoryId: '',
  ticketStaffRoleIds: [] as string[], ticketPrefix: 'form'
});

const emptyPanel = { formId: '', channelId: '', title: 'Compila il form', description: '', buttonLabel: 'Compila', enabled: true };

export default function FormsPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [forms, setForms] = useState<FormDef[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [panel, setPanel] = useState(emptyPanel);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedPermissionForm, setSelectedPermissionForm] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const textChannels = useMemo(() => channels.filter((channel) => channel.type === 0 || channel.type === 5), [channels]);
  const categories = useMemo(() => channels.filter((channel) => channel.type === 4), [channels]);

  const load = async () => {
    setError('');
    const [a, r, f, p] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/access`),
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/forms`),
      fetch(`/backend/api/guilds/${guildId}/form-panels`)
    ]);
    if (a.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }
    if (![a, r, f, p].every((response) => response.ok)) {
      setError('Impossibile caricare la configurazione dei form.');
      return;
    }
    const accessData = await a.json();
    const resources = await r.json();
    setAccess(accessData.access);
    setChannels(resources.channels);
    setRoles(resources.roles);
    setForms(await f.json());
    setPanels(await p.json());
  };

  useEffect(() => { void load(); }, [guildId]);

  const loadPermissions = async (formId: string) => {
    setSelectedPermissionForm(formId);
    if (!formId) { setPermissions([]); return; }
    const response = await fetch(`/backend/api/guilds/${guildId}/forms/${formId}/permissions`);
    if (response.ok) setPermissions(await response.json());
    else setPermissions([]);
  };

  const editForm = (row: FormDef) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      description: row.description ?? '',
      questions: row.questions ?? [],
      enabled: row.enabled,
      openAt: row.openAt ? row.openAt.slice(0, 16) : '',
      closeAt: row.closeAt ? row.closeAt.slice(0, 16) : '',
      deliveryMode: row.deliveryMode,
      resultChannelId: row.resultChannelId ?? '',
      resultRoleIds: row.resultRoleIds ?? [],
      allowedRoleIds: row.allowedRoleIds ?? [],
      deniedRoleIds: row.deniedRoleIds ?? [],
      maxSubmissionsPerUser: row.maxSubmissionsPerUser,
      cooldownSeconds: row.cooldownSeconds,
      submissionWindowMinutes: row.submissionWindowMinutes,
      maxAttemptsPerWindow: row.maxAttemptsPerWindow,
      createTicketOnSubmit: row.createTicketOnSubmit,
      ticketCategoryId: row.ticketCategoryId ?? '',
      ticketParentCategoryId: row.ticketParentCategoryId ?? '',
      ticketStaffRoleIds: row.ticketStaffRoleIds ?? [],
      ticketPrefix: row.ticketPrefix
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('form'); setError(''); setNotice('');
    try {
      const response = await fetch(
        editingId ? `/backend/api/guilds/${guildId}/forms/${editingId}` : `/backend/api/guilds/${guildId}/forms`,
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            description: form.description || null,
            openAt: form.openAt ? new Date(form.openAt).toISOString() : null,
            closeAt: form.closeAt ? new Date(form.closeAt).toISOString() : null,
            resultChannelId: form.resultChannelId || null,
            ticketCategoryId: form.ticketCategoryId || null,
            ticketParentCategoryId: form.ticketParentCategoryId || null
          })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(`Salvataggio fallito: ${body.error ?? response.status}`);
        return;
      }
      setNotice(editingId ? 'Form aggiornato.' : 'Form creato.');
      setEditingId(null); setForm(emptyForm());
      await load();
    } finally { setBusy(''); }
  };

  const removeForm = async (id: string) => {
    setBusy(`form:${id}`);
    const response = await fetch(`/backend/api/guilds/${guildId}/forms/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error === 'FORM_IN_USE' ? 'Il form ha già invii e non può essere eliminato.' : 'Eliminazione fallita.');
    } else {
      setNotice('Form eliminato.');
      await load();
    }
    setBusy('');
  };

  const addQuestion = () => {
    if (form.questions.length >= 25) return;
    let n = form.questions.length + 1;
    const used = new Set(form.questions.map((q) => q.id));
    while (used.has(`q${n}`)) n++;
    setForm({ ...form, questions: [...form.questions, emptyQuestion(n)] });
  };
  const updateQuestion = (index: number, patch: Partial<Question>) =>
    setForm({ ...form, questions: form.questions.map((q, i) => i === index ? { ...q, ...patch } : q) });
  const removeQuestion = (index: number) =>
    setForm({ ...form, questions: form.questions.filter((_, i) => i !== index) });

  const createPanel = async (event: FormEvent) => {
    event.preventDefault(); setBusy('panel'); setError(''); setNotice('');
    const response = await fetch(`/backend/api/guilds/${guildId}/form-panels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...panel, description: panel.description || null })
    });
    if (!response.ok) setError('Creazione pannello fallita.');
    else { setPanel(emptyPanel); setNotice('Pannello creato.'); await load(); }
    setBusy('');
  };

  const publishPanel = async (id: string) => {
    setBusy(`publish:${id}`);
    const response = await fetch(`/backend/api/guilds/${guildId}/form-panels/${id}/publish`, { method: 'POST' });
    if (!response.ok) setError('Pubblicazione pannello fallita.');
    else { setNotice('Pannello pubblicato o aggiornato.'); await load(); }
    setBusy('');
  };

  const deletePanel = async (id: string) => {
    setBusy(`panel:${id}`);
    const response = await fetch(`/backend/api/guilds/${guildId}/form-panels/${id}`, { method: 'DELETE' });
    if (!response.ok) setError('Eliminazione pannello fallita.');
    else { setNotice('Pannello eliminato.'); await load(); }
    setBusy('');
  };

  const savePermission = async (roleId: string, patch: Partial<Permission>) => {
    if (!selectedPermissionForm) return;
    const current = permissions.find((item) => item.discordRoleId === roleId);
    const next = {
      canManage: patch.canManage ?? current?.canManage ?? false,
      canView: patch.canView ?? current?.canView ?? false,
      canReview: patch.canReview ?? current?.canReview ?? false,
      canSubmit: patch.canSubmit ?? current?.canSubmit ?? false
    };
    const response = await fetch(`/backend/api/guilds/${guildId}/forms/${selectedPermissionForm}/permissions/${roleId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next)
    });
    if (response.ok) await loadPermissions(selectedPermissionForm);
    else setError('Aggiornamento permessi fallito.');
  };

  if (access && access !== 'ADMIN' && access !== 'OWNER') {
    return <main className="shell"><section className="card"><h1>Form</h1><p>La creazione globale richiede Admin/Owner. I singoli form possono comunque delegare gestione e revisione per ruolo.</p><a className="button secondary" href={`/dashboard/${guildId}`}>Torna indietro</a></section></main>;
  }

  return (
    <main className="shell">
      <div className="row">
        <div><p className="eyebrow">Dispatch</p><h1>Form</h1><p className="muted">Candidature, questionari e workflow con validazione e permessi granulari.</p></div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>Ticket</a>
          <a className="button secondary" href={`/dashboard/${guildId}`}>Permessi dashboard</a>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <form className="card form" onSubmit={save}>
          <div className="row"><h2>{editingId ? 'Modifica form' : 'Nuovo form'}</h2>{editingId && <button type="button" className="secondary" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>Annulla</button>}</div>
          <label>Nome<input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
          <label>Descrizione<textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
          <div className="grid compact-grid">
            <label>Modalità<select value={form.deliveryMode} onChange={(e) => setForm({ ...form, deliveryMode: e.target.value as 'EPHEMERAL' | 'DM' })}><option value="EPHEMERAL">In chat - solo utente</option><option value="DM">Messaggi privati</option></select></label>
            <label>Apertura<input type="datetime-local" value={form.openAt} onChange={(e) => setForm({ ...form, openAt: e.target.value })}/></label>
            <label>Chiusura<input type="datetime-local" value={form.closeAt} onChange={(e) => setForm({ ...form, closeAt: e.target.value })}/></label>
          </div>
          <label>Canale risultati<select value={form.resultChannelId} onChange={(e) => setForm({ ...form, resultChannelId: e.target.value })}><option value="">Nessuno</option>{textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
          <label>Ruoli da notificare<select multiple value={form.resultRoleIds} onChange={(e) => setForm({ ...form, resultRoleIds: [...e.target.selectedOptions].map((o) => o.value) })}>{roles.filter((r) => r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <fieldset><legend>Accesso e anti-spam</legend>
            <label>Ruoli autorizzati<select multiple value={form.allowedRoleIds} onChange={(e) => setForm({ ...form, allowedRoleIds: [...e.target.selectedOptions].map((o) => o.value) })}>{roles.filter((r) => r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label>Ruoli esclusi<select multiple value={form.deniedRoleIds} onChange={(e) => setForm({ ...form, deniedRoleIds: [...e.target.selectedOptions].map((o) => o.value) })}>{roles.filter((r) => r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <div className="grid compact-grid">
              <label>Invii massimi per utente<input type="number" min={0} max={1000} value={form.maxSubmissionsPerUser} onChange={(e) => setForm({ ...form, maxSubmissionsPerUser: Number(e.target.value) })}/></label>
              <label>Cooldown secondi<input type="number" min={0} max={2592000} value={form.cooldownSeconds} onChange={(e) => setForm({ ...form, cooldownSeconds: Number(e.target.value) })}/></label>
              <label>Finestra tentativi minuti<input type="number" min={1} max={10080} value={form.submissionWindowMinutes} onChange={(e) => setForm({ ...form, submissionWindowMinutes: Number(e.target.value) })}/></label>
              <label>Tentativi massimi<input type="number" min={1} max={100} value={form.maxAttemptsPerWindow} onChange={(e) => setForm({ ...form, maxAttemptsPerWindow: Number(e.target.value) })}/></label>
            </div>
          </fieldset>

          <fieldset><legend>Domande - massimo 25</legend>
            {form.questions.map((q, index) => <div className="subcard form" key={q.id}>
              <div className="row"><strong>Domanda {index + 1}</strong><button type="button" className="danger" onClick={() => removeQuestion(index)}>Rimuovi</button></div>
              <label>ID<input required value={q.id} onChange={(e) => updateQuestion(index, { id: e.target.value })}/></label>
              <label>Domanda<input required maxLength={100} value={q.label} onChange={(e) => updateQuestion(index, { label: e.target.value })}/></label>
              <label>Descrizione<textarea maxLength={500} value={q.description ?? ''} onChange={(e) => updateQuestion(index, { description: e.target.value || null })}/></label>
              <label>Tipo<select value={q.type} onChange={(e) => updateQuestion(index, { type: e.target.value as QuestionType, options: ['SINGLE_SELECT','MULTI_SELECT'].includes(e.target.value) ? q.options : [] })}>
                <option value="SHORT_TEXT">Testo breve</option><option value="LONG_TEXT">Testo lungo</option><option value="INTEGER">Intero</option><option value="NUMBER">Numero</option>
                <option value="EMAIL">Email</option><option value="URL">URL</option><option value="DATE">Data</option><option value="BOOLEAN">Sì/No</option>
                <option value="SINGLE_SELECT">Scelta singola</option><option value="MULTI_SELECT">Scelta multipla</option><option value="DISCORD_ID">ID Discord</option>
              </select></label>
              {(q.type === 'SINGLE_SELECT' || q.type === 'MULTI_SELECT') && <label>Opzioni - Etichetta|valore<textarea value={q.options.map((o) => `${o.label}|${o.value}`).join('\n')} onChange={(e) => updateQuestion(index, { options: e.target.value.split('\n').map((line) => { const [label, value] = line.split('|'); return { label: (label ?? '').trim(), value: (value ?? label ?? '').trim(), description: null }; }).filter((o) => o.label && o.value).slice(0,25) })}/></label>}
              <label className="checkbox-row"><input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(index, { required: e.target.checked })}/>Obbligatoria</label>
            </div>)}
            <button type="button" className="secondary" disabled={form.questions.length >= 25} onClick={addQuestion}>Aggiungi domanda</button>
          </fieldset>

          <fieldset><legend>Ticket automatico dopo invio</legend>
            <label className="checkbox-row"><input type="checkbox" checked={form.createTicketOnSubmit} onChange={(e) => setForm({ ...form, createTicketOnSubmit: e.target.checked })}/>Crea canale privato con report, compilatore e staff</label>
            {form.createTicketOnSubmit && <>
              <label>Categoria Discord<select required value={form.ticketParentCategoryId} onChange={(e) => setForm({ ...form, ticketParentCategoryId: e.target.value })}><option value="">Seleziona...</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Ruoli staff<select multiple value={form.ticketStaffRoleIds} onChange={(e) => setForm({ ...form, ticketStaffRoleIds: [...e.target.selectedOptions].map((o) => o.value) })}>{roles.filter((r) => r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label>Prefisso canale<input value={form.ticketPrefix} onChange={(e) => setForm({ ...form, ticketPrefix: e.target.value })}/></label>
            </>}
          </fieldset>
          <label className="checkbox-row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}/>Form abilitato</label>
          <button disabled={busy === 'form'} type="submit">{editingId ? 'Salva modifiche' : 'Crea form'}</button>
        </form>

        <form className="card form" onSubmit={createPanel}>
          <h2>Nuovo pannello form</h2>
          <label>Form<select required value={panel.formId} onChange={(e) => setPanel({ ...panel, formId: e.target.value })}><option value="">Seleziona...</option>{forms.filter((f) => f.enabled).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label>Canale<select required value={panel.channelId} onChange={(e) => setPanel({ ...panel, channelId: e.target.value })}><option value="">Seleziona...</option>{textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
          <label>Titolo<input required maxLength={256} value={panel.title} onChange={(e) => setPanel({ ...panel, title: e.target.value })}/></label>
          <label>Descrizione<textarea maxLength={2000} value={panel.description} onChange={(e) => setPanel({ ...panel, description: e.target.value })}/></label>
          <label>Testo pulsante<input required maxLength={80} value={panel.buttonLabel} onChange={(e) => setPanel({ ...panel, buttonLabel: e.target.value })}/></label>
          <button disabled={busy === 'panel'} type="submit">Crea pannello</button>
        </form>
      </section>

      <section><h2>Form configurati</h2><div className="grid">{forms.map((row) => <article className="card" key={row.id}>
        <h3>{row.name}</h3><p>{row.description || 'Nessuna descrizione.'}</p>
        <p className="muted">{row.questions.length} domande · {row.deliveryMode === 'DM' ? 'DM' : 'ephemeral'} · {row.enabled ? 'aperto secondo pianificazione' : 'disabilitato'}</p>
        <div className="actions"><button className="secondary" onClick={() => editForm(row)}>Modifica</button><button className="secondary" onClick={() => void loadPermissions(row.id)}>Permessi</button>
          <a className="button secondary" href={`/dashboard/${guildId}/forms/${row.id}`}>Invii</a>
          <button className="danger" disabled={busy === `form:${row.id}`} onClick={() => void removeForm(row.id)}>Elimina</button></div>
      </article>)}</div></section>

      <section><h2>Pannelli</h2><div className="grid">{panels.map((row) => <article className="card" key={row.id}>
        <h3>{row.form?.name ?? row.formId}</h3><p>{row.title}</p><p className="muted">{row.messageId ? 'Pubblicato' : 'Non pubblicato'}</p>
        <div className="actions"><button onClick={() => void publishPanel(row.id)} disabled={busy === `publish:${row.id}`}>{row.messageId ? 'Aggiorna su Discord' : 'Pubblica'}</button>
          <button className="danger" onClick={() => void deletePanel(row.id)} disabled={busy === `panel:${row.id}`}>Elimina</button></div>
      </article>)}</div></section>

      {selectedPermissionForm && <section className="card">
        <div className="row"><h2>Permessi del form</h2><button className="secondary" onClick={() => { setSelectedPermissionForm(''); setPermissions([]); }}>Chiudi</button></div>
        <p className="muted">Owner/Admin hanno sempre accesso. Queste regole delegano operazioni ai ruoli Discord.</p>
        {roles.filter((r) => r.id !== guildId).map((role) => {
          const p = permissions.find((item) => item.discordRoleId === role.id);
          return <div className="role" key={role.id}><strong>{role.name}</strong>
            {(['canManage','canView','canReview','canSubmit'] as const).map((key) => <label className="checkbox-row" key={key}><input type="checkbox" checked={p?.[key] ?? false} onChange={(e) => void savePermission(role.id, { [key]: e.target.checked })}/>{key.replace('can','')}</label>)}
          </div>;
        })}
      </section>}
    </main>
  );
}
