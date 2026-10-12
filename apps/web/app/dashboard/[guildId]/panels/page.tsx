'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourcePicker, { CHANNEL_TYPES, type PickerChannel } from '../../../_components/ResourcePicker';
import { useCopy } from '../../../_components/locale-context';
import { format, type Locale } from '../../../i18n';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
type PanelKind = 'TICKET' | 'FORM';
type PanelStyle = 'SELECT' | 'BUTTONS';
type ButtonStyleName = 'PRIMARY' | 'SECONDARY' | 'SUCCESS' | 'DANGER';

type Category = { id: string; name: string; description: string | null; enabled: boolean };
type FormDef = { id: string; name: string; description: string | null; enabled: boolean };

type PanelAppearance = {
  id: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string | null;
  style: string;
  placeholder: string | null;
  color: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footerText: string | null;
  items: unknown;
  enabled: boolean;
};
type TicketPanel = PanelAppearance & { name: string; categoryIds: string[] };
type FormPanel = PanelAppearance & {
  name: string | null;
  formId: string;
  formIds: string[];
  buttonLabel: string;
  form?: { name: string };
};

type MainMenu = {
  mainMenuEnabled: boolean;
  mainMenuChannelId: string | null;
  mainMenuMessageId: string | null;
  mainMenuTitle: string;
  mainMenuCategoryIds: string[];
};

type ItemOverride = { label: string; emoji: string; description: string; buttonStyle: ButtonStyleName | '' };

type Draft = {
  kind: PanelKind;
  id: string | null;
  name: string;
  channelId: string;
  title: string;
  description: string;
  useColor: boolean;
  color: string;
  imageUrl: string;
  thumbnailUrl: string;
  footerText: string;
  enabled: boolean;
  style: PanelStyle;
  placeholder: string;
  entryIds: string[];
  overrides: Record<string, ItemOverride>;
  buttonLabel: string;
};

type Row = {
  kind: PanelKind;
  id: string;
  name: string;
  channelId: string;
  count: number;
  enabled: boolean;
  published: boolean;
  style: PanelStyle;
};

const LIMITS = {
  items: 25,
  title: 256,
  description: 4000,
  footer: 2048,
  url: 2048,
  placeholder: 150,
  buttonLabel: 80,
  selectLabel: 100,
  selectDescription: 100,
  embedTotal: 6000
};

const BUTTON_STYLES: ButtonStyleName[] = ['PRIMARY', 'SECONDARY', 'SUCCESS', 'DANGER'];

const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
const DISCORD_IMAGE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

const it = {
  errors: {
    INVALID_BODY: 'Alcuni campi non sono validi.',
    PANEL_CHANNEL_NOT_FOUND: 'Il canale scelto non esiste o non è un canale testuale.',
    FORM_PANEL_CHANNEL_NOT_FOUND: 'Il canale scelto non esiste o non è un canale testuale.',
    CATEGORY_NOT_FOUND: 'Una o più categorie non esistono più o sono disabilitate.',
    FORM_NOT_FOUND: 'Uno o più form non esistono più.',
    PANEL_NOT_FOUND: 'Pannello non trovato o disabilitato.',
    FORM_PANEL_NOT_FOUND: 'Pannello non trovato o disabilitato.',
    PANEL_HAS_NO_CATEGORIES: 'Il pannello non contiene categorie abilitate.',
    PANEL_TOO_MANY_CATEGORIES: 'Il pannello supera le 25 categorie.',
    PANEL_HAS_NO_ITEMS: 'Il pannello non contiene form validi.',
    PANEL_CHANNEL_INVALID: 'Il canale del pannello non è più disponibile per il bot.',
    FORM_PANEL_CHANNEL_INVALID: 'Il canale del pannello non è più disponibile per il bot.',
    GUILD_NOT_FOUND: 'Il bot non è presente nel server.',
    FORBIDDEN: 'Serve il livello Admin o Owner.',
    QUOTA_EXCEEDED: 'Limite raggiunto per questo server: elimina un elemento esistente prima di crearne uno nuovo.'
  } as Record<string, string>,
  buttonStyles: {
    PRIMARY: 'Primario (blu)',
    SECONDARY: 'Secondario (grigio)',
    SUCCESS: 'Successo (verde)',
    DANGER: 'Pericolo (rosso)'
  } as Record<ButtonStyleName, string>,
  defaults: {
    ticketTitle: 'Apri un ticket',
    ticketDescription: 'Seleziona la categoria più adatta alla tua richiesta.',
    formTitle: 'Compila il form',
    buttonLabel: 'Compila'
  },
  loadAccessError: 'Non hai accesso a questo server oppure Discord non è raggiungibile.',
  loadError: 'Impossibile caricare i pannelli.',
  chooseCategory: 'Scegli almeno una categoria.',
  chooseForm: 'Scegli almeno un form.',
  chooseChannel: 'Scegli il canale in cui pubblicare il pannello.',
  httpsImages: 'Immagine e miniatura devono essere URL https.',
  saveFailed: 'Salvataggio fallito',
  publishFailed: 'Pubblicazione fallita',
  deleteFailed: 'Eliminazione fallita',
  updatedNotice: 'Pannello aggiornato. Usa "Aggiorna su Discord" per applicare le modifiche al messaggio.',
  createdNotice: 'Pannello creato. Ora puoi pubblicarlo su Discord.',
  messageUpdated: 'Messaggio aggiornato su Discord.',
  published: 'Pannello pubblicato su Discord.',
  confirmDelete: 'Eliminare il pannello "{name}"? Il messaggio già pubblicato su Discord non viene rimosso e smetterà di funzionare.',
  deleted: 'Pannello eliminato.',
  panels: 'Pannelli',
  restrictedTitle: 'Accesso riservato',
  restrictedText: 'La gestione dei pannelli Discord richiede il livello Admin o Owner del server.',
  backToOverview: 'Torna alla panoramica',
  intro: 'Messaggi Discord da cui gli utenti aprono ticket o compilano form.',
  newPanel: 'Nuovo pannello',
  backToList: 'Torna all’elenco',
  mainMenu: 'Menu principale',
  enabled: 'Abilitato',
  disabled: 'Disabilitato',
  requests: (count: number) => count === 1 ? '1 richiesta' : `${count} richieste`,
  isPublished: 'Pubblicato',
  notPublished: 'Non pubblicato',
  mainMenuHelp: 'Pulsante unico con selettore privato: si configura in Sistema e menu.',
  openSystem: 'Apri Sistema e menu',
  configured: 'Pannelli configurati',
  empty: 'Nessun pannello configurato. Crea il primo con “Nuovo pannello”.',
  colType: 'Tipo',
  colName: 'Nome',
  colChannel: 'Canale',
  colItems: 'Elementi',
  colStatus: 'Stato',
  colDiscord: 'Discord',
  colActions: 'Azioni',
  kindTicket: 'Ticket',
  kindForm: 'Form',
  styleButtons: 'Pulsanti',
  styleSelect: 'Menu a tendina',
  active: 'Attivo',
  inactive: 'Disattivo',
  edit: 'Modifica',
  enableToPublish: 'Abilita il pannello per pubblicarlo',
  sending: 'Invio…',
  updateOnDiscord: 'Aggiorna su Discord',
  publish: 'Pubblica',
  delete: 'Elimina',
  chooseKind: 'Che tipo di pannello vuoi creare?',
  ticketPanel: 'Pannello ticket',
  ticketPanelText: 'Gli utenti scelgono una categoria e aprono un ticket privato, con eventuali domande iniziali.',
  formPanel: 'Pannello form',
  formPanelText: 'Gli utenti scelgono e compilano uno dei form inclusi (candidature, segnalazioni...).',
  formPanelNoForms: 'Crea prima almeno un form nella sezione Form.',
  /* Editor */
  formDisabled: 'Disabilitato',
  editPanel: 'Modifica pannello',
  dropped: (count: number, ticket: boolean) => ticket
    ? `${count} categorie disabilitate o eliminate sono state rimosse dalla selezione: salva per aggiornare il pannello.`
    : `${count} form eliminati sono stati rimossi dalla selezione: salva per aggiornare il pannello.`,
  internalName: 'Nome interno',
  optional: '(facoltativo)',
  namePlaceholderTicket: 'Es. Supporto generale',
  namePlaceholderForm: 'Predefinito: nomi dei form',
  channel: 'Canale',
  channelPlaceholder: 'Cerca un canale testuale…',
  channelChangeHint: 'Cambiando canale verrà pubblicato un nuovo messaggio; il vecchio va rimosso a mano.',
  panelActive: 'Pannello attivo (un pannello disattivato non risponde e non può essere pubblicato)',
  embed: 'Embed',
  title: 'Titolo',
  description: 'Descrizione',
  sideColor: 'Colore laterale',
  color: 'Colore',
  imageUrl: 'URL immagine (https)',
  thumbnailUrl: 'URL miniatura (https)',
  footer: 'Footer',
  embedTooLong: 'Titolo, descrizione e footer superano i 6000 caratteri consentiti da Discord.',
  interaction: 'Interazione',
  panelStyle: 'Stile del pannello',
  menuPlaceholder: 'Testo segnaposto del menu',
  buttonsHelp: 'Un pulsante per elemento, 5 per riga, fino a 25.',
  buttonText: 'Testo del pulsante (se non personalizzato sotto)',
  categories: 'Categorie',
  forms: 'Form',
  includedCategories: 'Categorie incluse (solo abilitate)',
  includedForms: 'Form inclusi',
  itemsHint: 'Massimo {max}. Usa le frecce per cambiare l\'ordine.',
  moveUp: 'Sposta su {name}',
  moveDown: 'Sposta giù {name}',
  remove: 'Rimuovi',
  label: 'Etichetta',
  emoji: 'Emoji',
  emojiPlaceholder: '🎫 oppure <:nome:id>',
  none: 'Nessuna',
  buttonStyle: 'Stile pulsante',
  defaultStyle: 'Predefinito (primario)',
  noItems: 'Nessun elemento selezionato.',
  saving: 'Salvataggio…',
  saveChanges: 'Salva modifiche',
  createPanel: 'Crea pannello',
  cancel: 'Annulla',
  preview: 'Anteprima',
  previewNote: 'Anteprima indicativa: Discord applica il proprio rendering. Le immagini esterne non sono caricate qui per la Content Security Policy della dashboard.',
  /* Preview: mirrors the texts the bot sends */
  previewLabel: 'Anteprima del messaggio Discord',
  previewTitle: 'Titolo del pannello',
  thumbnail: 'Miniatura',
  image: 'Immagine',
  previewHint: 'Aggiungi almeno un elemento per vedere i componenti.',
  selectCategory: 'Seleziona una categoria',
  chooseAForm: 'Scegli un form',
  ticketButtonsFallback: 'Premi il pulsante del tipo di ticket da aprire.',
  ticketSelectFallback: 'Seleziona il tipo di ticket da aprire.',
  formSelectFallback: 'Scegli il form da compilare.',
  formButtonsFallback: 'Premi il pulsante per compilare il form.'
};

const en: typeof it = {
  errors: {
    INVALID_BODY: 'Some fields are not valid.',
    PANEL_CHANNEL_NOT_FOUND: 'The selected channel does not exist or is not a text channel.',
    FORM_PANEL_CHANNEL_NOT_FOUND: 'The selected channel does not exist or is not a text channel.',
    CATEGORY_NOT_FOUND: 'One or more categories no longer exist or are disabled.',
    FORM_NOT_FOUND: 'One or more forms no longer exist.',
    PANEL_NOT_FOUND: 'Panel not found or disabled.',
    FORM_PANEL_NOT_FOUND: 'Panel not found or disabled.',
    PANEL_HAS_NO_CATEGORIES: 'The panel has no enabled categories.',
    PANEL_TOO_MANY_CATEGORIES: 'The panel exceeds 25 categories.',
    PANEL_HAS_NO_ITEMS: 'The panel has no valid forms.',
    PANEL_CHANNEL_INVALID: 'The panel channel is no longer available to the bot.',
    FORM_PANEL_CHANNEL_INVALID: 'The panel channel is no longer available to the bot.',
    GUILD_NOT_FOUND: 'The bot is not in this server.',
    FORBIDDEN: 'Admin or Owner level required.',
    QUOTA_EXCEEDED: 'Limit reached for this server: delete an existing item before creating a new one.'
  } as Record<string, string>,
  buttonStyles: {
    PRIMARY: 'Primary (blue)',
    SECONDARY: 'Secondary (gray)',
    SUCCESS: 'Success (green)',
    DANGER: 'Danger (red)'
  },
  defaults: {
    ticketTitle: 'Open a ticket',
    ticketDescription: 'Select the category that best fits your request.',
    formTitle: 'Fill in the form',
    buttonLabel: 'Fill in'
  },
  loadAccessError: 'You do not have access to this server, or Discord cannot be reached.',
  loadError: 'Could not load the panels.',
  chooseCategory: 'Choose at least one category.',
  chooseForm: 'Choose at least one form.',
  chooseChannel: 'Choose the channel to publish the panel in.',
  httpsImages: 'Image and thumbnail must be https URLs.',
  saveFailed: 'Save failed',
  publishFailed: 'Publish failed',
  deleteFailed: 'Delete failed',
  updatedNotice: 'Panel updated. Use "Update on Discord" to apply the changes to the message.',
  createdNotice: 'Panel created. You can now publish it on Discord.',
  messageUpdated: 'Message updated on Discord.',
  published: 'Panel published on Discord.',
  confirmDelete: 'Delete the panel "{name}"? The message already published on Discord is not removed and will stop working.',
  deleted: 'Panel deleted.',
  panels: 'Panels',
  restrictedTitle: 'Restricted access',
  restrictedText: 'Managing Discord panels requires the Admin or Owner level on the server.',
  backToOverview: 'Back to overview',
  intro: 'Discord messages from which users open tickets or fill in forms.',
  newPanel: 'New panel',
  backToList: 'Back to the list',
  mainMenu: 'Main menu',
  enabled: 'Enabled',
  disabled: 'Disabled',
  requests: (count: number) => count === 1 ? '1 request' : `${count} requests`,
  isPublished: 'Published',
  notPublished: 'Not published',
  mainMenuHelp: 'Single button with a private selector: configured in System and menu.',
  openSystem: 'Open System and menu',
  configured: 'Configured panels',
  empty: 'No panels configured. Create the first one with “New panel”.',
  colType: 'Type',
  colName: 'Name',
  colChannel: 'Channel',
  colItems: 'Items',
  colStatus: 'Status',
  colDiscord: 'Discord',
  colActions: 'Actions',
  kindTicket: 'Ticket',
  kindForm: 'Form',
  styleButtons: 'Buttons',
  styleSelect: 'Select menu',
  active: 'Active',
  inactive: 'Inactive',
  edit: 'Edit',
  enableToPublish: 'Enable the panel to publish it',
  sending: 'Sending…',
  updateOnDiscord: 'Update on Discord',
  publish: 'Publish',
  delete: 'Delete',
  chooseKind: 'What kind of panel do you want to create?',
  ticketPanel: 'Ticket panel',
  ticketPanelText: 'Users pick a category and open a private ticket, with optional initial questions.',
  formPanel: 'Form panel',
  formPanelText: 'Users pick and fill in one of the included forms (applications, reports...).',
  formPanelNoForms: 'First create at least one form in the Forms section.',
  formDisabled: 'Disabled',
  editPanel: 'Edit panel',
  dropped: (count: number, ticket: boolean) => ticket
    ? `${count} disabled or deleted ${count === 1 ? 'category was' : 'categories were'} removed from the selection: save to update the panel.`
    : `${count} deleted ${count === 1 ? 'form was' : 'forms were'} removed from the selection: save to update the panel.`,
  internalName: 'Internal name',
  optional: '(optional)',
  namePlaceholderTicket: 'E.g. General support',
  namePlaceholderForm: 'Default: form names',
  channel: 'Channel',
  channelPlaceholder: 'Search a text channel…',
  channelChangeHint: 'Changing the channel publishes a new message; the old one must be removed manually.',
  panelActive: 'Panel active (a disabled panel does not respond and cannot be published)',
  embed: 'Embed',
  title: 'Title',
  description: 'Description',
  sideColor: 'Side color',
  color: 'Color',
  imageUrl: 'Image URL (https)',
  thumbnailUrl: 'Thumbnail URL (https)',
  footer: 'Footer',
  embedTooLong: 'Title, description and footer exceed the 6000 characters allowed by Discord.',
  interaction: 'Interaction',
  panelStyle: 'Panel style',
  menuPlaceholder: 'Menu placeholder text',
  buttonsHelp: 'One button per item, 5 per row, up to 25.',
  buttonText: 'Button text (unless customized below)',
  categories: 'Categories',
  forms: 'Forms',
  includedCategories: 'Included categories (enabled only)',
  includedForms: 'Included forms',
  itemsHint: 'Up to {max}. Use the arrows to change the order.',
  moveUp: 'Move {name} up',
  moveDown: 'Move {name} down',
  remove: 'Remove',
  label: 'Label',
  emoji: 'Emoji',
  emojiPlaceholder: '🎫 or <:name:id>',
  none: 'None',
  buttonStyle: 'Button style',
  defaultStyle: 'Default (primary)',
  noItems: 'No items selected.',
  saving: 'Saving…',
  saveChanges: 'Save changes',
  createPanel: 'Create panel',
  cancel: 'Cancel',
  preview: 'Preview',
  previewNote: 'Approximate preview: Discord applies its own rendering. External images are not loaded here because of the dashboard Content Security Policy.',
  previewLabel: 'Discord message preview',
  previewTitle: 'Panel title',
  thumbnail: 'Thumbnail',
  image: 'Image',
  previewHint: 'Add at least one item to see the components.',
  selectCategory: 'Select a category',
  chooseAForm: 'Choose a form',
  ticketButtonsFallback: 'Press the button for the type of ticket you want to open.',
  ticketSelectFallback: 'Select the type of ticket you want to open.',
  formSelectFallback: 'Choose the form you want to fill in.',
  formButtonsFallback: 'Press the button to fill in the form.'
};

const copy: Record<Locale, typeof it> = { it, en };

const describeError = (errors: Record<string, string>, prefix: string, body: { error?: string; reason?: string; details?: { fieldErrors?: Record<string, unknown> } }, status: number) => {
  const code = body.reason ?? body.error;
  const fields = body.details?.fieldErrors ? Object.keys(body.details.fieldErrors) : [];
  const text = (code && errors[code]) ?? `${code ?? status}`;
  return `${prefix}: ${text}${fields.length ? ` (${fields.join(', ')})` : ''}`;
};

const hexColor = (value: number | null) =>
  value === null ? '#38bdf8' : `#${value.toString(16).padStart(6, '0')}`;

const isHttps = (value: string) => {
  if (!value) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const emptyOverride = (): ItemOverride => ({ label: '', emoji: '', description: '', buttonStyle: '' });

function parseOverrides(raw: unknown): Record<string, ItemOverride> {
  const result: Record<string, ItemOverride> = {};
  if (!Array.isArray(raw)) return result;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string') continue;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    const style = text(row.buttonStyle);
    result[row.id] = {
      label: text(row.label),
      emoji: text(row.emoji),
      description: text(row.description),
      buttonStyle: BUTTON_STYLES.includes(style as ButtonStyleName) ? style as ButtonStyleName : ''
    };
  }
  return result;
}

function newDraft(kind: PanelKind, defaults: typeof it.defaults): Draft {
  return {
    kind,
    id: null,
    name: '',
    channelId: '',
    title: kind === 'TICKET' ? defaults.ticketTitle : defaults.formTitle,
    description: kind === 'TICKET' ? defaults.ticketDescription : '',
    useColor: false,
    color: '#38bdf8',
    imageUrl: '',
    thumbnailUrl: '',
    footerText: '',
    enabled: true,
    style: kind === 'TICKET' ? 'SELECT' : 'BUTTONS',
    placeholder: '',
    entryIds: [],
    overrides: {},
    buttonLabel: defaults.buttonLabel
  };
}

function draftFrom(kind: PanelKind, panel: TicketPanel | FormPanel, entryIds: string[], defaultButtonLabel: string): Draft {
  return {
    kind,
    id: panel.id,
    name: panel.name ?? '',
    channelId: panel.channelId,
    title: panel.title,
    description: panel.description ?? '',
    useColor: panel.color !== null,
    color: hexColor(panel.color),
    imageUrl: panel.imageUrl ?? '',
    thumbnailUrl: panel.thumbnailUrl ?? '',
    footerText: panel.footerText ?? '',
    enabled: panel.enabled,
    style: panel.style === 'BUTTONS' ? 'BUTTONS' : 'SELECT',
    placeholder: panel.placeholder ?? '',
    entryIds,
    overrides: parseOverrides(panel.items),
    buttonLabel: 'buttonLabel' in panel ? panel.buttonLabel : defaultButtonLabel
  };
}

function payloadFrom(draft: Draft, defaultButtonLabel: string) {
  const items = draft.entryIds.flatMap((id) => {
    const override = draft.overrides[id];
    if (!override) return [];
    const item = {
      id,
      label: override.label.trim() || null,
      emoji: override.emoji.trim() || null,
      description: draft.style === 'SELECT' ? override.description.trim() || null : null,
      buttonStyle: draft.style === 'BUTTONS' ? override.buttonStyle || null : null
    };
    return item.label || item.emoji || item.description || item.buttonStyle ? [item] : [];
  });
  const common = {
    channelId: draft.channelId,
    title: draft.title,
    description: draft.description.trim() || null,
    style: draft.style,
    placeholder: draft.style === 'SELECT' ? draft.placeholder.trim() || null : null,
    color: draft.useColor ? Number.parseInt(draft.color.slice(1), 16) : null,
    imageUrl: draft.imageUrl.trim() || null,
    thumbnailUrl: draft.thumbnailUrl.trim() || null,
    footerText: draft.footerText.trim() || null,
    enabled: draft.enabled,
    items
  };
  return draft.kind === 'TICKET'
    ? { ...common, name: draft.name, categoryIds: draft.entryIds }
    : { ...common, name: draft.name.trim() || null, formIds: draft.entryIds, buttonLabel: draft.buttonLabel || defaultButtonLabel };
}

function EmojiPreview({ value }: { value: string }) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const custom = CUSTOM_EMOJI.exec(trimmed);
  if (custom) {
    const extension = custom[1] === 'a' ? 'gif' : 'webp';
    return <img className="discord-emoji" src={`https://cdn.discordapp.com/emojis/${custom[3]}.${extension}?size=48`} alt={`:${custom[2]}:`} />;
  }
  return <span className="discord-emoji-text" aria-hidden="true">{trimmed}</span>;
}

function PreviewImage({ url, className, label }: { url: string; className: string; label: string }) {
  if (!url || !isHttps(url)) return null;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  // The dashboard CSP only allows Discord CDN images: other hosts get a placeholder.
  if (DISCORD_IMAGE_HOSTS.has(host)) return <img className={className} src={url} alt={label} />;
  return <div className={`${className} discord-image-placeholder`}><span>{label}</span><small className="mono">{host}</small></div>;
}

type PreviewEntry = { id: string; label: string; description: string | null; emoji: string; buttonStyle: ButtonStyleName };

function PanelPreview({ draft, entries, fallbackDescription, defaultPlaceholder }: {
  draft: Draft;
  entries: PreviewEntry[];
  fallbackDescription: string;
  defaultPlaceholder: string;
}) {
  const c = useCopy(copy);
  const rows: PreviewEntry[][] = [];
  for (let index = 0; index < Math.min(entries.length, LIMITS.items); index += 5) rows.push(entries.slice(index, index + 5));
  return (
    <div className="discord-preview" aria-label={c.previewLabel}>
      <div className="discord-message">
        <div className="discord-avatar" aria-hidden="true">D</div>
        <div className="discord-body">
          <div className="discord-author"><strong>Dispatch</strong><span className="discord-app-tag">APP</span></div>
          <div className="discord-embed" style={draft.useColor ? { borderLeftColor: draft.color } : undefined}>
            <div className="discord-embed-grid">
              <div className="discord-embed-main">
                <div className="discord-embed-title">{draft.title || c.previewTitle}</div>
                <div className="discord-embed-description">{draft.description.trim() || fallbackDescription}</div>
              </div>
              <PreviewImage url={draft.thumbnailUrl.trim()} className="discord-embed-thumbnail" label={c.thumbnail} />
            </div>
            <PreviewImage url={draft.imageUrl.trim()} className="discord-embed-image" label={c.image} />
            <div className="discord-embed-footer">{draft.footerText.trim() || 'Dispatch'}</div>
          </div>
          {!entries.length && <p className="discord-hint">{c.previewHint}</p>}
          {entries.length > 0 && draft.style === 'SELECT' && (
            <div className="discord-select">
              <div className="discord-select-box">
                <span>{draft.placeholder.trim() || defaultPlaceholder}</span>
                <span aria-hidden="true">▾</span>
              </div>
              <ul className="discord-select-options">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <EmojiPreview value={entry.emoji} />
                    <div>
                      <strong>{entry.label}</strong>
                      {entry.description && <span>{entry.description}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {entries.length > 0 && draft.style === 'BUTTONS' && (
            <div className="discord-buttons">
              {rows.map((row, rowIndex) => (
                <div className="discord-button-row" key={rowIndex}>
                  {row.map((entry) => (
                    <span className={`discord-button discord-button-${entry.buttonStyle.toLowerCase()}`} key={entry.id}>
                      <EmojiPreview value={entry.emoji} />
                      <span>{entry.label}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return <small className={`field-counter${value.length > max ? ' is-over' : ''}`}>{value.length}/{max}</small>;
}

export default function PanelsPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);

  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [channels, setChannels] = useState<PickerChannel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [forms, setForms] = useState<FormDef[]>([]);
  const [ticketPanels, setTicketPanels] = useState<TicketPanel[]>([]);
  const [formPanels, setFormPanels] = useState<FormPanel[]>([]);
  const [mainMenu, setMainMenu] = useState<MainMenu | null>(null);
  const [view, setView] = useState<'list' | 'choose' | 'edit'>('list');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dropped, setDropped] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isAdmin = access === 'ADMIN' || access === 'OWNER';

  const load = async () => {
    setError('');
    const accessResponse = await fetch(`/backend/api/guilds/${guildId}/access`);
    if (accessResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }
    if (!accessResponse.ok) {
      setError(c.loadAccessError);
      return;
    }
    const accessData = await accessResponse.json() as { access: AccessLevel };
    setAccess(accessData.access);
    if (accessData.access !== 'ADMIN' && accessData.access !== 'OWNER') return;

    const responses = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/categories`),
      fetch(`/backend/api/guilds/${guildId}/forms`),
      fetch(`/backend/api/guilds/${guildId}/panels`),
      fetch(`/backend/api/guilds/${guildId}/form-panels`),
      fetch(`/backend/api/guilds/${guildId}/ticket-system-settings`)
    ]);
    if (!responses.every((response) => response.ok)) {
      setError(c.loadError);
      return;
    }
    const [resources, categoryRows, formRows, ticketRows, formPanelRows, settings] = await Promise.all(
      responses.map((response) => response.json())
    );
    setChannels((resources as { channels: PickerChannel[] }).channels);
    setCategories(categoryRows as Category[]);
    setForms(formRows as FormDef[]);
    setTicketPanels(ticketRows as TicketPanel[]);
    setFormPanels(formPanelRows as FormPanel[]);
    setMainMenu(settings as MainMenu);
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const channelName = (id: string | null) => {
    if (!id) return '—';
    const channel = channels.find((row) => row.id === id);
    return channel ? `#${channel.name}` : id;
  };

  const rows: Row[] = useMemo(() => [
    ...ticketPanels.map((panel) => ({
      kind: 'TICKET' as const,
      id: panel.id,
      name: panel.name,
      channelId: panel.channelId,
      count: panel.categoryIds.length,
      enabled: panel.enabled,
      published: Boolean(panel.messageId),
      style: panel.style === 'BUTTONS' ? 'BUTTONS' as const : 'SELECT' as const
    })),
    ...formPanels.map((panel) => {
      const ids = panel.formIds.length ? panel.formIds : [panel.formId];
      const names = ids.map((id) => forms.find((form) => form.id === id)?.name).filter(Boolean);
      return {
        kind: 'FORM' as const,
        id: panel.id,
        name: panel.name || names.join(', ') || panel.form?.name || panel.title,
        channelId: panel.channelId,
        count: ids.length,
        enabled: panel.enabled,
        published: Boolean(panel.messageId),
        style: panel.style === 'SELECT' ? 'SELECT' as const : 'BUTTONS' as const
      };
    })
  ], [ticketPanels, formPanels, forms]);

  const startNew = (kind: PanelKind) => {
    setDraft(newDraft(kind, c.defaults));
    setDropped(0);
    setView('edit');
    setNotice('');
    setError('');
  };

  const editPanel = (kind: PanelKind, id: string) => {
    setNotice('');
    setError('');
    if (kind === 'TICKET') {
      const panel = ticketPanels.find((row) => row.id === id);
      if (!panel) return;
      const enabledIds = new Set(categories.filter((category) => category.enabled).map((category) => category.id));
      const entryIds = panel.categoryIds.filter((categoryId) => enabledIds.has(categoryId));
      setDropped(panel.categoryIds.length - entryIds.length);
      setDraft(draftFrom('TICKET', panel, entryIds, c.defaults.buttonLabel));
    } else {
      const panel = formPanels.find((row) => row.id === id);
      if (!panel) return;
      const known = new Set(forms.map((form) => form.id));
      const ids = panel.formIds.length ? panel.formIds : [panel.formId];
      const entryIds = ids.filter((formId) => known.has(formId));
      setDropped(ids.length - entryIds.length);
      setDraft(draftFrom('FORM', panel, entryIds, c.defaults.buttonLabel));
    }
    setView('edit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeEditor = () => {
    setDraft(null);
    setView('list');
  };

  const basePath = (kind: PanelKind) =>
    `/backend/api/guilds/${guildId}/${kind === 'TICKET' ? 'panels' : 'form-panels'}`;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setError('');
    setNotice('');
    if (!draft.entryIds.length) {
      setError(draft.kind === 'TICKET' ? c.chooseCategory : c.chooseForm);
      return;
    }
    if (!draft.channelId) {
      setError(c.chooseChannel);
      return;
    }
    if (!isHttps(draft.imageUrl.trim()) || !isHttps(draft.thumbnailUrl.trim())) {
      setError(c.httpsImages);
      return;
    }
    setBusy('save');
    try {
      const response = await fetch(draft.id ? `${basePath(draft.kind)}/${draft.id}` : basePath(draft.kind), {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFrom(draft, c.defaults.buttonLabel))
      });
      if (!response.ok) {
        setError(describeError(c.errors, c.saveFailed, await response.json().catch(() => ({})), response.status));
        return;
      }
      setNotice(draft.id ? c.updatedNotice : c.createdNotice);
      closeEditor();
      await load();
    } finally {
      setBusy('');
    }
  };

  const publish = async (row: Row) => {
    setBusy(`publish:${row.id}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${basePath(row.kind)}/${row.id}/publish`, { method: 'POST' });
      if (!response.ok) {
        setError(describeError(c.errors, c.publishFailed, await response.json().catch(() => ({})), response.status));
        return;
      }
      setNotice(row.published ? c.messageUpdated : c.published);
      await load();
    } finally {
      setBusy('');
    }
  };

  const remove = async (row: Row) => {
    const confirmed = window.confirm(format(c.confirmDelete, { name: row.name }));
    if (!confirmed) return;
    setBusy(`delete:${row.id}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${basePath(row.kind)}/${row.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setError(describeError(c.errors, c.deleteFailed, await response.json().catch(() => ({})), response.status));
        return;
      }
      setNotice(c.deleted);
      await load();
    } finally {
      setBusy('');
    }
  };

  if (access && !isAdmin) {
    return (
      <main className="shell">
        <section className="card">
          <p className="eyebrow">{c.panels}</p>
          <h1>{c.restrictedTitle}</h1>
          <p>{c.restrictedText}</p>
          <a className="button secondary" href={`/dashboard/${guildId}`}>{c.backToOverview}</a>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch</p>
          <h1>{c.panels}</h1>
          <p className="muted">{c.intro}</p>
        </div>
        <div className="actions">
          {view === 'list' && (
            <button type="button" disabled={!loaded} onClick={() => { setView('choose'); setNotice(''); setError(''); }}>
              {c.newPanel}
            </button>
          )}
          {view !== 'list' && <button type="button" className="secondary" onClick={closeEditor}>{c.backToList}</button>}
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}

      {view === 'list' && (
        <>
          {mainMenu && (
            <section className="card panel-menu-card">
              <div className="row">
                <div>
                  <span className="tag tag-accent">{c.mainMenu}</span>
                  <h2>{mainMenu.mainMenuTitle}</h2>
                  <p className="muted">
                    {mainMenu.mainMenuEnabled ? c.enabled : c.disabled} · {channelName(mainMenu.mainMenuChannelId)} ·{' '}
                    {c.requests(mainMenu.mainMenuCategoryIds.length)} · {mainMenu.mainMenuMessageId ? c.isPublished : c.notPublished}
                  </p>
                  <p className="muted">{c.mainMenuHelp}</p>
                </div>
                <a className="button secondary" href={`/dashboard/${guildId}/tickets/system`}>{c.openSystem}</a>
              </div>
            </section>
          )}

          <section>
            <h2>{c.configured}</h2>
            {loaded && !rows.length && <div className="card muted">{c.empty}</div>}
            {rows.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{c.colType}</th>
                      <th>{c.colName}</th>
                      <th>{c.colChannel}</th>
                      <th>{c.colItems}</th>
                      <th>{c.colStatus}</th>
                      <th>{c.colDiscord}</th>
                      <th><span className="visually-hidden">{c.colActions}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.kind}:${row.id}`}>
                        <td>
                          <span className={`tag ${row.kind === 'TICKET' ? 'tag-accent' : 'tag-info'}`}>
                            {row.kind === 'TICKET' ? c.kindTicket : c.kindForm}
                          </span>
                        </td>
                        <td className="panel-name-cell">
                          <strong>{row.name}</strong>
                          <small className="muted">{row.style === 'BUTTONS' ? c.styleButtons : c.styleSelect}</small>
                        </td>
                        <td>{channelName(row.channelId)}</td>
                        <td className="mono">{row.count}</td>
                        <td>
                          <span className={`state ${row.enabled ? 'state-ok' : 'state-warn'}`}>{row.enabled ? c.active : c.inactive}</span>
                        </td>
                        <td>
                          <span className={`state ${row.published ? 'state-info' : 'state-warn'}`}>{row.published ? c.isPublished : c.notPublished}</span>
                        </td>
                        <td>
                          <div className="actions panel-row-actions">
                            <button type="button" className="secondary" onClick={() => editPanel(row.kind, row.id)}>{c.edit}</button>
                            <button
                              type="button"
                              disabled={!row.enabled || busy === `publish:${row.id}`}
                              title={row.enabled ? undefined : c.enableToPublish}
                              onClick={() => void publish(row)}
                            >
                              {busy === `publish:${row.id}` ? c.sending : row.published ? c.updateOnDiscord : c.publish}
                            </button>
                            <button
                              type="button"
                              className="danger"
                              disabled={busy === `delete:${row.id}`}
                              onClick={() => void remove(row)}
                            >
                              {c.delete}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {view === 'choose' && (
        <section>
          <h2>{c.chooseKind}</h2>
          <div className="panel-kind-grid">
            <button type="button" className="panel-kind" onClick={() => startNew('TICKET')}>
              <span className="tag tag-accent">{c.kindTicket}</span>
              <strong>{c.ticketPanel}</strong>
              <span>{c.ticketPanelText}</span>
            </button>
            <button type="button" className="panel-kind" onClick={() => startNew('FORM')} disabled={!forms.length}>
              <span className="tag tag-info">{c.kindForm}</span>
              <strong>{c.formPanel}</strong>
              <span>{forms.length ? c.formPanelText : c.formPanelNoForms}</span>
            </button>
          </div>
        </section>
      )}

      {view === 'edit' && draft && (
        <PanelEditor
          draft={draft}
          setDraft={setDraft}
          dropped={dropped}
          channels={channels}
          categories={categories}
          forms={forms}
          busy={busy === 'save'}
          onSubmit={save}
          onCancel={closeEditor}
        />
      )}
    </main>
  );
}

function PanelEditor({ draft, setDraft, dropped, channels, categories, forms, busy, onSubmit, onCancel }: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  dropped: number;
  channels: PickerChannel[];
  categories: Category[];
  forms: FormDef[];
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const c = useCopy(copy);
  const ticket = draft.kind === 'TICKET';
  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const available = ticket
    ? categories.filter((category) => category.enabled).map((category) => ({ id: category.id, name: category.name, hint: category.description }))
    : forms.map((form) => ({ id: form.id, name: form.name, hint: form.enabled ? null : c.formDisabled }));
  const sourceRows: Array<{ id: string; name: string; description: string | null }> = ticket ? categories : forms;
  const lookup = new Map(sourceRows.map((row) => [row.id, { name: row.name, description: row.description }]));
  const labelMax = draft.style === 'BUTTONS' ? LIMITS.buttonLabel : LIMITS.selectLabel;
  const single = !ticket && draft.entryIds.length === 1;

  const defaultLabel = (id: string) => {
    if (!ticket && draft.style === 'BUTTONS' && single) return draft.buttonLabel || c.defaults.buttonLabel;
    return lookup.get(id)?.name ?? id;
  };

  const entries: PreviewEntry[] = draft.entryIds.map((id) => {
    const override = draft.overrides[id] ?? emptyOverride();
    return {
      id,
      label: (override.label.trim() || defaultLabel(id)).slice(0, labelMax),
      description: (override.description.trim() || lookup.get(id)?.description || '').slice(0, LIMITS.selectDescription) || null,
      emoji: override.emoji,
      buttonStyle: override.buttonStyle || 'PRIMARY'
    };
  });

  const setOverride = (id: string, patch: Partial<ItemOverride>) => update({
    overrides: { ...draft.overrides, [id]: { ...(draft.overrides[id] ?? emptyOverride()), ...patch } }
  });

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.entryIds.length) return;
    const entryIds = [...draft.entryIds];
    [entryIds[index], entryIds[target]] = [entryIds[target]!, entryIds[index]!];
    update({ entryIds });
  };

  const fallbackDescription = ticket
    ? (draft.style === 'BUTTONS' ? c.ticketButtonsFallback : c.ticketSelectFallback)
    : ((single ? lookup.get(draft.entryIds[0]!)?.description : null)
      || (draft.style === 'SELECT' ? c.formSelectFallback : c.formButtonsFallback));
  const embedLength = draft.title.length + (draft.description.trim() || '').length + (draft.footerText.trim() || 'Dispatch').length;

  return (
    <form className="panel-editor" onSubmit={onSubmit}>
      <div className="panel-editor-fields">
        <section className="card form">
          <div className="row">
            <h2>{draft.id ? c.editPanel : c.newPanel}</h2>
            <span className={`tag ${ticket ? 'tag-accent' : 'tag-info'}`}>{ticket ? c.kindTicket : c.kindForm}</span>
          </div>
          {dropped > 0 && (
            <p className="notice notice-warn">{c.dropped(dropped, ticket)}</p>
          )}
          <label>
            {c.internalName} {ticket ? '' : c.optional}
            <input
              required={ticket}
              maxLength={80}
              value={draft.name}
              placeholder={ticket ? c.namePlaceholderTicket : c.namePlaceholderForm}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <ResourcePicker
            label={c.channel}
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
            placeholder={c.channelPlaceholder}
            required
            value={draft.channelId}
            onChange={(channelId) => update({ channelId })}
            hint={draft.id ? c.channelChangeHint : undefined}
          />
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
            {c.panelActive}
          </label>
        </section>

        <section className="card form">
          <h2>{c.embed}</h2>
          <label>
            <span className="field-head">{c.title} <Counter value={draft.title} max={LIMITS.title} /></span>
            <input required maxLength={LIMITS.title} value={draft.title} onChange={(event) => update({ title: event.target.value })} />
          </label>
          <label>
            <span className="field-head">{c.description} <Counter value={draft.description} max={LIMITS.description} /></span>
            <textarea
              maxLength={LIMITS.description}
              value={draft.description}
              placeholder={fallbackDescription}
              onChange={(event) => update({ description: event.target.value })}
            />
          </label>
          <div className="inline-fields">
            <label className="checkbox-row">
              <input type="checkbox" checked={draft.useColor} onChange={(event) => update({ useColor: event.target.checked })} />
              {c.sideColor}
            </label>
            <label>
              {c.color}
              <input
                type="color"
                value={draft.color}
                disabled={!draft.useColor}
                onChange={(event) => update({ color: event.target.value, useColor: true })}
              />
            </label>
          </div>
          <label>
            {c.imageUrl}
            <input
              type="url"
              maxLength={LIMITS.url}
              value={draft.imageUrl}
              placeholder="https://..."
              aria-invalid={!isHttps(draft.imageUrl.trim()) || undefined}
              onChange={(event) => update({ imageUrl: event.target.value })}
            />
          </label>
          <label>
            {c.thumbnailUrl}
            <input
              type="url"
              maxLength={LIMITS.url}
              value={draft.thumbnailUrl}
              placeholder="https://..."
              aria-invalid={!isHttps(draft.thumbnailUrl.trim()) || undefined}
              onChange={(event) => update({ thumbnailUrl: event.target.value })}
            />
          </label>
          <label>
            <span className="field-head">{c.footer} <Counter value={draft.footerText} max={LIMITS.footer} /></span>
            <input
              maxLength={LIMITS.footer}
              value={draft.footerText}
              placeholder="Dispatch"
              onChange={(event) => update({ footerText: event.target.value })}
            />
          </label>
          {embedLength > LIMITS.embedTotal && (
            <p className="notice notice-error">{c.embedTooLong}</p>
          )}
        </section>

        <section className="card form">
          <h2>{c.interaction}</h2>
          <div className="segmented" role="radiogroup" aria-label={c.panelStyle}>
            {(['SELECT', 'BUTTONS'] as const).map((style) => (
              <label className={`segmented-option${draft.style === style ? ' is-active' : ''}`} key={style}>
                <input
                  type="radio"
                  name="panel-style"
                  value={style}
                  checked={draft.style === style}
                  onChange={() => update({ style })}
                />
                {style === 'SELECT' ? c.styleSelect : c.styleButtons}
              </label>
            ))}
          </div>
          {draft.style === 'SELECT' ? (
            <label>
              <span className="field-head">{c.menuPlaceholder} <Counter value={draft.placeholder} max={LIMITS.placeholder} /></span>
              <input
                maxLength={LIMITS.placeholder}
                value={draft.placeholder}
                placeholder={ticket ? c.selectCategory : c.chooseAForm}
                onChange={(event) => update({ placeholder: event.target.value })}
              />
            </label>
          ) : (
            <p className="muted">{c.buttonsHelp}</p>
          )}
          {!ticket && draft.style === 'BUTTONS' && single && (
            <label>
              {c.buttonText}
              <input
                required
                maxLength={LIMITS.buttonLabel}
                value={draft.buttonLabel}
                onChange={(event) => update({ buttonLabel: event.target.value })}
              />
            </label>
          )}
        </section>

        <section className="card form">
          <h2>{ticket ? c.categories : c.forms}</h2>
          <ResourcePicker
            label={ticket ? c.includedCategories : c.includedForms}
            kind="item"
            items={available}
            multiple
            max={LIMITS.items}
            hint={format(c.itemsHint, { max: LIMITS.items })}
            value={draft.entryIds}
            onChange={(entryIds) => update({ entryIds })}
          />
          <ol className="panel-items">
            {draft.entryIds.map((id, index) => {
              const override = draft.overrides[id] ?? emptyOverride();
              const name = lookup.get(id)?.name ?? id;
              return (
                <li className="subcard panel-item" key={id}>
                  <div className="row">
                    <strong><span className="mono muted">{index + 1}.</span> {name}</strong>
                    <div className="actions">
                      <button type="button" className="secondary button-sm" aria-label={format(c.moveUp, { name })} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                      <button type="button" className="secondary button-sm" aria-label={format(c.moveDown, { name })} disabled={index === draft.entryIds.length - 1} onClick={() => move(index, 1)}>↓</button>
                      <button
                        type="button"
                        className="danger button-sm"
                        onClick={() => update({ entryIds: draft.entryIds.filter((entryId) => entryId !== id) })}
                      >
                        {c.remove}
                      </button>
                    </div>
                  </div>
                  <div className="panel-item-fields">
                    <label>
                      {c.label}
                      <input
                        maxLength={labelMax}
                        value={override.label}
                        placeholder={defaultLabel(id).slice(0, labelMax)}
                        onChange={(event) => setOverride(id, { label: event.target.value })}
                      />
                    </label>
                    <label>
                      {c.emoji}
                      <input
                        maxLength={64}
                        value={override.emoji}
                        placeholder={c.emojiPlaceholder}
                        onChange={(event) => setOverride(id, { emoji: event.target.value })}
                      />
                    </label>
                    {draft.style === 'SELECT' ? (
                      <label className="panel-item-wide">
                        {c.description}
                        <input
                          maxLength={LIMITS.selectDescription}
                          value={override.description}
                          placeholder={(lookup.get(id)?.description ?? '').slice(0, LIMITS.selectDescription) || c.none}
                          onChange={(event) => setOverride(id, { description: event.target.value })}
                        />
                      </label>
                    ) : (
                      <label>
                        {c.buttonStyle}
                        <select
                          value={override.buttonStyle}
                          onChange={(event) => setOverride(id, { buttonStyle: event.target.value as ButtonStyleName | '' })}
                        >
                          <option value="">{c.defaultStyle}</option>
                          {BUTTON_STYLES.map((style) => <option value={style} key={style}>{c.buttonStyles[style]}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {!draft.entryIds.length && <p className="muted">{c.noItems}</p>}
        </section>

        <div className="actions">
          <button type="submit" disabled={busy}>{busy ? c.saving : draft.id ? c.saveChanges : c.createPanel}</button>
          <button type="button" className="secondary" onClick={onCancel}>{c.cancel}</button>
        </div>
      </div>

      <aside className="panel-editor-preview">
        <p className="eyebrow">{c.preview}</p>
        <PanelPreview
          draft={draft}
          entries={entries}
          fallbackDescription={fallbackDescription}
          defaultPlaceholder={ticket ? c.selectCategory : c.chooseAForm}
        />
        <p className="muted panel-preview-note">{c.previewNote}</p>
      </aside>
    </form>
  );
}
