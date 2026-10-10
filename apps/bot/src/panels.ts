import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} from 'discord.js';
import {
  PANEL_DEFAULT_FOOTER,
  PANEL_LIMITS,
  isHttpsUrl,
  layoutPanelButtons,
  normalizePanelItems,
  panelItemLabel,
  parsePanelEmoji,
  type PanelButtonStyle,
  type PanelStyle
} from '@dispatch/shared';

/*
 * Message builders shared by ticket and form panels. No database access, so
 * the layout can be tested without Discord or PostgreSQL.
 */

export type PanelAppearance = {
  title: string;
  description: string | null;
  color: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footerText: string | null;
};

export type PanelEntry = {
  id: string;
  /** Label used when the panel has no override for this entry. */
  label: string;
  /** Select option description used when the panel has no override. */
  description?: string | null;
};

export type PanelComponentOptions = {
  style: PanelStyle;
  placeholder: string | null;
  defaultPlaceholder: string;
  items: unknown;
  entries: PanelEntry[];
  selectCustomId: string;
  buttonCustomId: (entryId: string) => string;
  defaultButtonStyle?: PanelButtonStyle;
};

const BUTTON_STYLES: Record<PanelButtonStyle, ButtonStyle> = {
  PRIMARY: ButtonStyle.Primary,
  SECONDARY: ButtonStyle.Secondary,
  SUCCESS: ButtonStyle.Success,
  DANGER: ButtonStyle.Danger
};

export function panelStyle(raw: string | null | undefined, fallback: PanelStyle): PanelStyle {
  return raw === 'SELECT' || raw === 'BUTTONS' ? raw : fallback;
}

function customId(value: string) {
  if (value.length > PANEL_LIMITS.customId) throw new Error('PANEL_CUSTOM_ID_TOO_LONG');
  return value;
}

export function panelEmbed(panel: PanelAppearance, fallbackDescription: string) {
  const embed = new EmbedBuilder()
    .setTitle(panel.title.slice(0, PANEL_LIMITS.title))
    .setDescription((panel.description || fallbackDescription).slice(0, PANEL_LIMITS.description))
    .setFooter({ text: (panel.footerText || PANEL_DEFAULT_FOOTER).slice(0, PANEL_LIMITS.footer) });
  if (panel.color !== null && Number.isInteger(panel.color) && panel.color >= 0 && panel.color <= 0xffffff) {
    embed.setColor(panel.color);
  }
  if (panel.imageUrl && isHttpsUrl(panel.imageUrl)) embed.setImage(panel.imageUrl);
  if (panel.thumbnailUrl && isHttpsUrl(panel.thumbnailUrl)) embed.setThumbnail(panel.thumbnailUrl);
  return embed;
}

/**
 * SELECT: one string select (placeholder, label/emoji/description overrides).
 * BUTTONS: up to 5 rows of 5 buttons (label/emoji/style overrides).
 */
export function panelComponents(options: PanelComponentOptions) {
  const entries = options.entries.slice(0, PANEL_LIMITS.items);
  const overrides = new Map(
    normalizePanelItems(options.items, entries.map((entry) => entry.id)).map((item) => [item.id, item])
  );

  if (options.style === 'SELECT') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId(options.selectCustomId))
      .setPlaceholder((options.placeholder || options.defaultPlaceholder).slice(0, PANEL_LIMITS.placeholder))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(entries.map((entry) => {
        const override = overrides.get(entry.id);
        const emoji = parsePanelEmoji(override?.emoji);
        const description = (override?.description || entry.description || '').slice(0, PANEL_LIMITS.selectDescription);
        return {
          label: panelItemLabel('SELECT', override?.label, entry.label),
          value: entry.id,
          ...(description ? { description } : {}),
          ...(emoji ? { emoji } : {})
        };
      }));
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
  }

  return layoutPanelButtons(entries).map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    row.map((entry) => {
      const override = overrides.get(entry.id);
      const emoji = parsePanelEmoji(override?.emoji);
      const button = new ButtonBuilder()
        .setCustomId(customId(options.buttonCustomId(entry.id)))
        .setLabel(panelItemLabel('BUTTONS', override?.label, entry.label))
        .setStyle(BUTTON_STYLES[override?.buttonStyle ?? options.defaultButtonStyle ?? 'PRIMARY']);
      if (emoji) button.setEmoji(emoji);
      return button;
    })
  ));
}
