import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from 'discord.js';
import { prisma } from '@dispatch/db';
import {
  displayAnswer,
  normalizeQuestions,
  validateQuestionAnswer,
  type FormAnswer,
  type FormQuestion
} from '@dispatch/shared';
import { decryptText, encryptText } from './security.js';
import { ticketControls } from './tickets.js';

const START = 'dispatch:form:start:';
const TEXT = 'dispatch:form:text:';
const TEXT_MODAL = 'dispatch:form:text-modal:';
const SELECT = 'dispatch:form:select:';
const BOOL = 'dispatch:form:bool:';
const CANCEL = 'dispatch:form:cancel:';
const SESSION_TTL_MS = 30 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{24}$/;

type FormInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

const token = () => randomBytes(18).toString('base64url');
const sourceKey = (panelId: string) => `panel:${panelId}`;

function answersFrom(value: string | null): FormAnswer[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(decryptText(value) ?? '[]');
    return Array.isArray(parsed) ? parsed as FormAnswer[] : [];
  } catch {
    return [];
  }
}

function safeChannelPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 24) || 'user';
}

function isOpen(form: { enabled: boolean; openAt: Date | null; closeAt: Date | null }) {
  const now = Date.now();
  return form.enabled && (!form.openAt || form.openAt.getTime() <= now) &&
    (!form.closeAt || form.closeAt.getTime() > now);
}

async function canSubmit(
  guildId: string,
  userId: string,
  form: {
    id: string;
    allowedRoleIds: string[];
    deniedRoleIds: string[];
    maxSubmissionsPerUser: number;
    cooldownSeconds: number;
    submissionWindowMinutes: number;
    maxAttemptsPerWindow: number;
  },
  client: Client,
  activeSessionId?: string
) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { ok: false, message: 'Server non disponibile.' };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, message: 'Devi essere nel server per compilare questo form.' };

  if (form.deniedRoleIds.some((id) => member.roles.cache.has(id))) {
    return { ok: false, message: 'Non puoi compilare questo form.' };
  }
  if (form.allowedRoleIds.length && !form.allowedRoleIds.some((id) => member.roles.cache.has(id))) {
    return { ok: false, message: 'Non hai un ruolo autorizzato a compilare questo form.' };
  }

  const explicit = await prisma.formPermissionBinding.findMany({
    where: { guildId, formId: form.id, discordRoleId: { in: [...member.roles.cache.keys()] } }
  });
  if (explicit.length && !explicit.some((binding) => binding.canSubmit)) {
    return { ok: false, message: 'I tuoi ruoli non consentono l’invio di questo form.' };
  }

  const [total, recent, latest, active] = await Promise.all([
    prisma.formSubmission.count({ where: { guildId, formId: form.id, userId } }),
    prisma.formSession.count({ where: {
      guildId, formId: form.id, userId,
      ...(activeSessionId ? { id: { not: activeSessionId } } : {}),
      createdAt: { gte: new Date(Date.now() - form.submissionWindowMinutes * 60_000) }
    } }),
    prisma.formSubmission.findFirst({
      where: { guildId, formId: form.id, userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    }),
    prisma.formSession.findFirst({
      where: { guildId, formId: form.id, userId, state: 'ACTIVE', expiresAt: { gt: new Date() } },
      select: { id: true }
    })
  ]);

  if (active) return { ok: false, message: 'Hai già una compilazione in corso.' };
  if (form.maxSubmissionsPerUser > 0 && total >= form.maxSubmissionsPerUser) {
    return { ok: false, message: 'Hai raggiunto il numero massimo di invii consentiti.' };
  }
  if (recent >= form.maxAttemptsPerWindow) {
    return { ok: false, message: 'Troppi tentativi recenti. Riprova più tardi.' };
  }
  if (latest) {
    const remaining = latest.createdAt.getTime() + form.cooldownSeconds * 1000 - Date.now();
    if (remaining > 0) {
      return { ok: false, message: `Riprova tra circa ${Math.ceil(remaining / 1000)} secondi.` };
    }
  }
  return { ok: true as const, member };
}

function questionDescription(question: FormQuestion, index: number, total: number) {
  const parts = [`**${index + 1}/${total} - ${question.label}**`];
  if (question.description) parts.push(question.description);
  if (!question.required) parts.push('_Facoltativa_');
  return parts.join('\n');
}

async function sendPrivate(interaction: FormInteraction, content: string, components: any[] = []) {
  if (interaction.inGuild()) {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, components, ephemeral: true });
    } else {
      await interaction.reply({ content, components, ephemeral: true });
    }
    return;
  }
  if ('channel' in interaction && interaction.channel && 'send' in interaction.channel) {
    await interaction.channel.send({ content, components });
  }
}

async function getSession(rawToken: string, userId: string) {
  if (!TOKEN.test(rawToken)) return null;
  return prisma.formSession.findFirst({
    where: { token: rawToken, userId, state: 'ACTIVE', expiresAt: { gt: new Date() } },
    include: { form: true }
  });
}

function promptComponents(sessionToken: string, question: FormQuestion, index: number) {
  const suffix = `${sessionToken}:${index}`;
  if (question.type === 'SINGLE_SELECT' || question.type === 'MULTI_SELECT') {
    const options = (question.options ?? []).slice(0, 25).map((option) => ({
      label: option.label.slice(0, 100),
      value: option.value.slice(0, 100),
      description: option.description?.slice(0, 100) || undefined
    }));
    const min = question.type === 'MULTI_SELECT' ? (question.minSelections ?? (question.required ? 1 : 0)) : 1;
    const max = question.type === 'MULTI_SELECT'
      ? Math.min(question.maxSelections ?? options.length, options.length)
      : 1;
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(SELECT + suffix)
        .setPlaceholder('Seleziona...')
        .setMinValues(Math.min(min, max))
        .setMaxValues(Math.max(1, max))
        .addOptions(options)
    )];
  }
  if (question.type === 'BOOLEAN') {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(BOOL + suffix + ':true').setLabel('Sì').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BOOL + suffix + ':false').setLabel('No').setStyle(ButtonStyle.Secondary),
      ...(!question.required
        ? [new ButtonBuilder().setCustomId(BOOL + suffix + ':skip').setLabel('Salta').setStyle(ButtonStyle.Secondary)]
        : [])
    )];
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(TEXT + suffix).setLabel(question.required ? 'Rispondi' : 'Rispondi / salta')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CANCEL + sessionToken).setLabel('Annulla').setStyle(ButtonStyle.Danger)
  )];
}

async function promptQuestion(interaction: FormInteraction, sessionToken: string) {
  const session = await getSession(sessionToken, interaction.user.id);
  if (!session) {
    await sendPrivate(interaction, 'Questa compilazione è scaduta o non è più valida.');
    return;
  }
  const questions = normalizeQuestions(session.form.questions);
  const question = questions[session.currentQuestion];
  if (!question) {
    await finalizeSubmission(interaction, sessionToken);
    return;
  }
  await sendPrivate(
    interaction,
    questionDescription(question, session.currentQuestion, questions.length),
    promptComponents(sessionToken, question, session.currentQuestion)
  );
}

async function storeAnswer(interaction: FormInteraction, sessionToken: string, index: number, raw: unknown) {
  const session = await getSession(sessionToken, interaction.user.id);
  if (!session || session.currentQuestion !== index) {
    await sendPrivate(interaction, 'Questa domanda non è più valida.');
    return;
  }
  const questions = normalizeQuestions(session.form.questions);
  const question = questions[index];
  if (!question) {
    await sendPrivate(interaction, 'Domanda non valida.');
    return;
  }
  const result = validateQuestionAnswer(question, raw);
  if (!result.ok) {
    await sendPrivate(interaction, result.message, promptComponents(sessionToken, question, index));
    return;
  }

  const answers = answersFrom(session.answersEncrypted);
  answers.push({ id: question.id, label: question.label, type: question.type, value: result.value });
  await prisma.formSession.update({
    where: { id: session.id },
    data: {
      answersEncrypted: encryptText(JSON.stringify(answers)),
      currentQuestion: { increment: 1 },
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  });
  await promptQuestion(interaction, sessionToken);
}

function reportEmbeds(
  title: string,
  submissionId: string,
  userId: string,
  answers: FormAnswer[],
  questions: FormQuestion[]
) {
  const embeds: EmbedBuilder[] = [];
  for (let offset = 0; offset < answers.length; offset += 20) {
    const embed = new EmbedBuilder()
      .setTitle(offset === 0 ? title.slice(0, 256) : `${title.slice(0, 230)} - continua`)
      .setFooter({ text: `Dispatch form - ${submissionId}` })
      .setTimestamp();
    if (offset === 0) embed.setDescription(`Compilato da <@${userId}> (\`${userId}\`)`);
    embed.addFields(...answers.slice(offset, offset + 20).map((answer) => ({
      name: answer.label.slice(0, 256),
      value: displayAnswer(answer, questions.find((question) => question.id === answer.id)).slice(0, 1024) || 'Nessuna risposta'
    })));
    embeds.push(embed);
  }
  return embeds.length ? embeds : [new EmbedBuilder().setTitle(title).setDescription(`Compilato da <@${userId}> senza risposte.`)];
}

async function finalizeSubmission(interaction: FormInteraction, sessionToken: string) {
  const session = await getSession(sessionToken, interaction.user.id);
  if (!session) {
    await sendPrivate(interaction, 'Questa compilazione è scaduta o è già stata inviata.');
    return;
  }
  const questions = normalizeQuestions(session.form.questions);
  const answers = answersFrom(session.answersEncrypted);
  if (answers.length !== questions.length) {
    await sendPrivate(interaction, 'La compilazione non è completa.');
    return;
  }

  const guild = interaction.client.guilds.cache.get(session.guildId);
  if (!guild || !isOpen(session.form)) {
    await prisma.formSession.update({ where: { id: session.id }, data: { state: 'CANCELLED' } });
    await sendPrivate(interaction, 'Il form è stato chiuso prima dell’invio.');
    return;
  }

  const permission = await canSubmit(session.guildId, session.userId, session.form, interaction.client, session.id);
  if (!permission.ok) {
    await prisma.formSession.update({ where: { id: session.id }, data: { state: 'CANCELLED' } });
    await sendPrivate(interaction, permission.message);
    return;
  }

  const submission = await prisma.$transaction(async (tx) => {
    const locked = await tx.formSession.updateMany({
      where: { id: session.id, state: 'ACTIVE', expiresAt: { gt: new Date() } },
      data: { state: 'SUBMITTING' }
    });
    if (locked.count !== 1) throw new Error('FORM_SESSION_ALREADY_USED');
    return tx.formSubmission.create({ data: {
      guildId: session.guildId,
      formId: session.formId,
      userId: session.userId,
      username: interaction.user.username,
      answersEncrypted: encryptText(JSON.stringify(answers))!,
      source: session.source
    } });
  });

  let reportChannelId: string | null = null;
  let reportMessageId: string | null = null;
  let ticketChannelId: string | null = null;
  const embeds = reportEmbeds(session.form.name, submission.id, session.userId, answers, questions);

  if (session.form.resultChannelId) {
    const channel = await guild.channels.fetch(session.form.resultChannelId).catch(() => null);
    if (channel?.isTextBased() && 'send' in channel) {
      const message = await channel.send({
        content: session.form.resultRoleIds.map((id) => `<@&${id}>`).join(' ') || undefined,
        embeds,
        allowedMentions: { parse: [], roles: session.form.resultRoleIds, users: [] }
      }).catch(() => null);
      if (message) {
        reportChannelId = channel.id;
        reportMessageId = message.id;
      }
    }
  }

  if (session.form.createTicketOnSubmit && session.form.ticketCategoryId) {
    const category = await prisma.ticketCategory.findFirst({
      where: { id: session.form.ticketCategoryId, guildId: session.guildId, enabled: true }
    });
    if (category) {
      const staffRoleIds = session.form.ticketStaffRoleIds.length
        ? session.form.ticketStaffRoleIds
        : category.staffRoleIds;
      const participant = [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks
      ];
      const counter = await prisma.guildSettings.update({
        where: { guildId: session.guildId },
        data: { ticketCounter: { increment: 1 } },
        select: { ticketCounter: true }
      });
      const number = counter.ticketCounter;
      const channel = await guild.channels.create({
        name: `ticket-${String(number).padStart(4, '0')}-${safeChannelPart(interaction.user.username)}`,
        type: ChannelType.GuildText,
        parent: session.form.ticketParentCategoryId ?? category.discordCategoryId ?? undefined,
        topic: `Dispatch ticket #${number} - ${session.userId} - form ${session.form.name}`.slice(0, 1024),
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.CreatePublicThreads,
            PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads] },
          { id: interaction.client.user!.id, type: 1, allow: [...participant, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
          { id: session.userId, type: 1, allow: participant },
          ...staffRoleIds.map((id) => ({
            id, type: 0 as const, allow: [...participant, PermissionFlagsBits.ManageMessages]
          }))
        ]
      }).catch(() => null);

      if (channel) {
        try {
          const ticket = await prisma.ticket.create({
            data: {
              guildId: session.guildId,
              categoryId: category.id,
              ticketNumber: number,
              openerId: session.userId,
              channelId: channel.id,
              status: 'OPEN',
              formDataEncrypted: encryptText(JSON.stringify(answers)),
              lastActivityAt: new Date(),
              members: { create: { userId: session.userId, access: 'OPENER' } },
              audit: { create: {
                guildId: session.guildId,
                actorId: session.userId,
                action: 'ticket.open.from_form',
                details: { formId: session.form.id, submissionId: submission.id }
              } }
            }
          });
          ticketChannelId = channel.id;
          await channel.send({
            content: staffRoleIds.map((id) => `<@&${id}>`).join(' ') || undefined,
            embeds,
            components: [ticketControls(ticket.id)],
            allowedMentions: { parse: [], roles: staffRoleIds, users: [] }
          }).catch(() => null);
        } catch (error) {
          await channel.delete('Dispatch: failed form ticket persistence').catch(() => null);
          throw error;
        }
      }
    }
  }

  await prisma.$transaction([
    prisma.formSubmission.update({
      where: { id: submission.id },
      data: { reportChannelId, reportMessageId, ticketChannelId }
    }),
    prisma.formSession.update({ where: { id: session.id }, data: { state: 'COMPLETED' } })
  ]);

  await sendPrivate(
    interaction,
    `Form inviato correttamente.${ticketChannelId ? ` È stato creato <#${ticketChannelId}>.` : ''}`
  );
}

async function beginForm(interaction: ButtonInteraction) {
  if (!interaction.guildId || !interaction.guild) return;
  const panelId = interaction.customId.slice(START.length);
  const panel = await prisma.formPanel.findFirst({
    where: {
      id: panelId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: interaction.message.id,
      enabled: true
    },
    include: { form: true }
  });
  if (!panel || !isOpen(panel.form)) {
    await interaction.reply({ content: 'Questo form non è disponibile.', ephemeral: true });
    return;
  }
  const questions = normalizeQuestions(panel.form.questions);
  if (!questions.length) {
    await interaction.reply({ content: 'Questo form non contiene domande valide.', ephemeral: true });
    return;
  }

  const permission = await canSubmit(interaction.guildId, interaction.user.id, panel.form, interaction.client);
  if (!permission.ok) {
    await interaction.reply({ content: permission.message, ephemeral: true });
    return;
  }

  const sessionToken = token();
  const session = await prisma.formSession.create({ data: {
    guildId: interaction.guildId,
    formId: panel.form.id,
    userId: interaction.user.id,
    token: sessionToken,
    source: sourceKey(panel.id),
    channelId: interaction.channelId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS)
  } });

  if (panel.form.deliveryMode === 'DM') {
    const dm = await interaction.user.createDM().catch(() => null);
    if (!dm) {
      await prisma.formSession.update({ where: { id: session.id }, data: { state: 'CANCELLED' } });
      await interaction.reply({ content: 'Non riesco ad aprire i tuoi messaggi privati.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: 'Ti ho inviato il form in privato.', ephemeral: true });
    const question = questions[0]!;
    await dm.send({
      content: questionDescription(question, 0, questions.length),
      components: promptComponents(sessionToken, question, 0)
    });
    return;
  }

  await interaction.reply({
    content: questionDescription(questions[0]!, 0, questions.length),
    components: promptComponents(sessionToken, questions[0]!, 0),
    ephemeral: true
  });
}

async function openTextModal(interaction: ButtonInteraction) {
  const raw = interaction.customId.slice(TEXT.length);
  const [sessionToken, indexRaw] = raw.split(':');
  const index = Number(indexRaw);
  if (!sessionToken || !Number.isInteger(index)) return;

  const session = await getSession(sessionToken, interaction.user.id);
  if (!session || session.currentQuestion !== index) {
    await interaction.reply({ content: 'Questa domanda è scaduta.', ephemeral: interaction.inGuild() });
    return;
  }
  const question = normalizeQuestions(session.form.questions)[index];
  if (!question) return;

  const modal = new ModalBuilder()
    .setCustomId(`${TEXT_MODAL}${sessionToken}:${index}`)
    .setTitle(question.label.slice(0, 45));
  const input = new TextInputBuilder()
    .setCustomId('answer')
    .setLabel(question.label.slice(0, 45))
    .setStyle(question.type === 'LONG_TEXT' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(question.required)
    .setMaxLength(question.maxLength ?? 4000);
  if (question.placeholder) input.setPlaceholder(question.placeholder);
  if (question.minLength != null) input.setMinLength(question.minLength);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

async function submitText(interaction: ModalSubmitInteraction) {
  const raw = interaction.customId.slice(TEXT_MODAL.length);
  const [sessionToken, indexRaw] = raw.split(':');
  const index = Number(indexRaw);
  if (!sessionToken || !Number.isInteger(index)) return;
  const value = interaction.fields.getTextInputValue('answer');
  await storeAnswer(interaction, sessionToken, index, value);
}

async function selectAnswer(interaction: StringSelectMenuInteraction) {
  const raw = interaction.customId.slice(SELECT.length);
  const [sessionToken, indexRaw] = raw.split(':');
  const index = Number(indexRaw);
  if (!sessionToken || !Number.isInteger(index)) return;
  await storeAnswer(interaction, sessionToken, index, interaction.values.length === 1 ? interaction.values[0] : interaction.values);
}

async function boolAnswer(interaction: ButtonInteraction) {
  const raw = interaction.customId.slice(BOOL.length);
  const [sessionToken, indexRaw, value] = raw.split(':');
  const index = Number(indexRaw);
  if (!sessionToken || !Number.isInteger(index) || !value) return;
  await storeAnswer(interaction, sessionToken, index, value === 'skip' ? '' : value);
}

async function cancel(interaction: ButtonInteraction) {
  const sessionToken = interaction.customId.slice(CANCEL.length);
  if (!TOKEN.test(sessionToken)) return;
  await prisma.formSession.updateMany({
    where: { token: sessionToken, userId: interaction.user.id, state: 'ACTIVE' },
    data: { state: 'CANCELLED' }
  });
  await sendPrivate(interaction, 'Compilazione annullata.');
}

export async function publishFormPanel(client: Client, guildId: string, panelId: string) {
  const panel = await prisma.formPanel.findFirst({
    where: { id: panelId, guildId, enabled: true },
    include: { form: true }
  });
  if (!panel) throw new Error('FORM_PANEL_NOT_FOUND');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('GUILD_NOT_FOUND');
  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('FORM_PANEL_CHANNEL_INVALID');

  const payload = {
    embeds: [new EmbedBuilder()
      .setTitle(panel.title)
      .setDescription(panel.description || panel.form.description || 'Premi il pulsante per compilare il form.')
      .setFooter({ text: 'Dispatch' })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(START + panel.id).setLabel(panel.buttonLabel).setStyle(ButtonStyle.Primary)
    )]
  };

  let messageId: string;
  if (panel.messageId) {
    try {
      const existing = await channel.messages.fetch(panel.messageId);
      messageId = (await existing.edit(payload)).id;
    } catch (error) {
      if ((error as { code?: number }).code !== 10008) throw error;
      messageId = (await channel.send(payload)).id;
    }
  } else {
    messageId = (await channel.send(payload)).id;
  }
  await prisma.formPanel.update({ where: { id: panel.id }, data: { messageId } });
  return { ok: true as const, messageId };
}

export function isFormInteraction(customId: string) {
  return [START, TEXT, TEXT_MODAL, SELECT, BOOL, CANCEL].some((prefix) => customId.startsWith(prefix));
}

export async function handleFormInteraction(interaction: FormInteraction) {
  if (interaction.isButton() && interaction.customId.startsWith(START)) return beginForm(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(TEXT)) return openTextModal(interaction);
  if (interaction.isModalSubmit() && interaction.customId.startsWith(TEXT_MODAL)) return submitText(interaction);
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SELECT)) return selectAnswer(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(BOOL)) return boolAnswer(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(CANCEL)) return cancel(interaction);
}
