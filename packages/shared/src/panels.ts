/*
 * Pure helpers for ticket/form panels (no Discord or database imports), so
 * the API, the bot and the tests share the same limits and parsing rules.
 */

export const PANEL_STYLES = ['SELECT', 'BUTTONS'] as const;
export type PanelStyle = (typeof PANEL_STYLES)[number];

export const PANEL_BUTTON_STYLES = ['PRIMARY', 'SECONDARY', 'SUCCESS', 'DANGER'] as const;
export type PanelButtonStyle = (typeof PANEL_BUTTON_STYLES)[number];

/** Discord limits that apply to panel messages and their components. */
export const PANEL_LIMITS = {
  items: 25,
  buttonsPerRow: 5,
  rows: 5,
  title: 256,
  description: 4000,
  footer: 2048,
  url: 2048,
  placeholder: 150,
  buttonLabel: 80,
  selectLabel: 100,
  selectDescription: 100,
  embedTotal: 6000,
  customId: 100
} as const;

export const PANEL_DEFAULT_FOOTER = 'Dispatch';

export type PanelItemOverride = {
  id: string;
  label: string | null;
  emoji: string | null;
  description: string | null;
  buttonStyle: PanelButtonStyle | null;
};

export type PanelEmoji = { name: string; id?: string; animated?: boolean };

const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
// One emoji "cluster": pictographs (with ZWJ sequences, variation selectors,
// skin tones and tag sequences), flags (regional indicator pairs) or keycaps.
const UNICODE_EMOJI = /^(?:[0-9#*]️?⃣|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[️\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*(?:‍\p{Extended_Pictographic}[️\u{1F3FB}-\u{1F3FF}]*)*)$/u;
const ITEM_ID = /^[a-z0-9]{20,32}$/i;

/**
 * Parses a unicode emoji ("🎫") or a custom one ("<:name:id>" / "<a:name:id>")
 * into the shape discord.js components accept. Anything else is null, so an
 * invalid value is simply omitted from the component.
 */
export function parsePanelEmoji(raw: unknown): PanelEmoji | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 64) return null;
  const custom = CUSTOM_EMOJI.exec(value);
  if (custom) {
    return { name: custom[2]!, id: custom[3]!, ...(custom[1] === 'a' ? { animated: true } : {}) };
  }
  return UNICODE_EMOJI.test(value) ? { name: value } : null;
}

export function isValidPanelEmoji(raw: unknown) {
  return parsePanelEmoji(raw) !== null;
}

export function isHttpsUrl(raw: unknown) {
  if (typeof raw !== 'string' || !raw || raw.length > PANEL_LIMITS.url) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) || null : null;

/**
 * Sanitises stored per-item overrides: only items still included in the panel
 * (allowedIds), at most one entry per id, bounded strings, valid emoji/style.
 */
export function normalizePanelItems(raw: unknown, allowedIds: readonly string[]): PanelItemOverride[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const items: PanelItemOverride[] = [];
  for (const entry of raw.slice(0, 50)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' && ITEM_ID.test(row.id) ? row.id : null;
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    const emoji = typeof row.emoji === 'string' && isValidPanelEmoji(row.emoji) ? row.emoji.trim() : null;
    const buttonStyle = typeof row.buttonStyle === 'string' &&
      (PANEL_BUTTON_STYLES as readonly string[]).includes(row.buttonStyle)
      ? row.buttonStyle as PanelButtonStyle
      : null;
    items.push({
      id,
      label: text(row.label, PANEL_LIMITS.selectLabel),
      emoji,
      description: text(row.description, PANEL_LIMITS.selectDescription),
      buttonStyle
    });
  }
  return items;
}

/**
 * Lays out up to 25 buttons in rows of 5 (Discord: max 5 action rows, max 5
 * buttons each). Extra items are dropped.
 */
export function layoutPanelButtons<T>(items: readonly T[]): T[][] {
  const capped = items.slice(0, PANEL_LIMITS.buttonsPerRow * PANEL_LIMITS.rows);
  const rows: T[][] = [];
  for (let index = 0; index < capped.length; index += PANEL_LIMITS.buttonsPerRow) {
    rows.push(capped.slice(index, index + PANEL_LIMITS.buttonsPerRow));
  }
  return rows;
}

/** Effective label of one panel entry for the given style. */
export function panelItemLabel(style: PanelStyle, override: string | null | undefined, fallback: string) {
  const max = style === 'BUTTONS' ? PANEL_LIMITS.buttonLabel : PANEL_LIMITS.selectLabel;
  return (override?.trim() || fallback.trim() || '-').slice(0, max);
}
