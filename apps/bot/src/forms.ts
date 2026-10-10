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
  type Guild,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel
} from 'discord.js';
import pino from 'pino';
import { prisma, type TicketCategory } from '@dispatch/db';
import {
  displayAnswer,
  normalizeQuestions,
  selectionBounds,
  validateQuestionAnswer,
  type FormAnswer,
  type FormQuestion
} from '@dispatch/shared';
import { decryptText, encryptText } from './security.js';
import { ticketControls } from './tickets.js';
import { logTicketEvent, userMention } from './ticket-log.js';
import { panelComponents, panelEmbed, panelStyle } from './panels.js';
import {
  reserveTicketOpen, consumeTicketOpenReservation, commitTicketOpen,
  releaseTicketOpenReservation, ticketOpenReservationMessage, formVersion
} from './open-guard.js';

// dispatch:form:start:<panelId>:<formId> (button) and the legacy
// dispatch:form:start:<panelId> of messages published before multi-form
// panels (= the panel's first form).
const START = 'dispatch:form:start:';
// dispatch:form:pick:<panelId>, value = formId (SELECT style panels).
const PICK = 'dispatch:form:pick:';
const CUID = /^[a-z0-9]{20,32}$/i;
const TEXT = 'dispatch:form:text:';
const TEXT_MODAL = 'dispatch:form:text-modal:';
const SELECT = 'dispatch:form:select:';
const BOOL = 'dispatch:form:bool:';
const SKIP = 'dispatch:form:skip:';
const CANCEL = 'dispatch:form:cancel:';
const SESSION_TTL_MS = 30 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{24}$/;
// Discord rejects a message whose embeds exceed 6000 characters in total.
const REPORT_MESSAGE_BUDGET = 5500;
const NO_MENTIONS = { parse: [] as never[] };

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

type FormInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

const token = () => randomBytes(18).toString('base64url');
const sourceKey = (panelId: string) => `panel:${panelId}`;
const errorInfo = (error: unknown) => ({
  errorType: error instanceof Error ? error.name : 'UnknownError',
  code: (error as { code?: unknown } | null)?.code
});

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

  const now = new Date();
  const blacklisted = await prisma.guildBlacklist.findFirst({
    where: { guildId, userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true }
  });
  if (blacklisted) return { ok: false, message: 'Non puoi compilare form in questo server.' };

  if (form.deniedRoleIds.some((id) => member.roles.cache.has(id))) {
    return { ok: false, message: 'Non puoi compilare questo form.' };
  }
  if (form.allowedRoleIds.length && !form.allowedRoleIds.some((id) => member.roles.cache.has(id))) {
    return { ok: false, message: 'Non hai un ruolo autorizzato a compilare questo form.' };
  }

  // Submit bindings are an allow-list: once any role is granted canSubmit,
  // only holders of those roles may submit. Bindings without canSubmit
  // (view/review/manage) never restrict submission.
  const submitters = await prisma.formPermissionBinding.findMany({
    where: { guildId, formId: form.id, canSubmit: true },
    select: { discordRoleId: true }
  });
  if (submitters.length && !submitters.some((binding) => member.roles.cache.has(binding.discordRoleId))) {
    return { ok: false, message: 'I tuoi ruoli non consentono l’invio di questo form.' };
  }

  const [total, recent, latest, active] = await Promise.all([
    prisma.formSubmission.count({ where: { guildId, formId: form.id, userId } }),
    prisma.formSession.count({ where: {
      guildId, formId: form.id, userId,
      ...(activeSessionId ? { id: { not: activeSessionId } } : {}),
      createdAt: { gte: new Date(now.getTime() - form.submissionWindowMinutes * 60_000) }
    } }),
    prisma.formSubmission.findFirst({
      where: { guildId, formId: form.id, userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    }),
    prisma.formSession.findFirst({
      where: {
        guildId, formId: form.id, userId, state: 'ACTIVE', expiresAt: { gt: now },
        ...(activeSessionId ? { id: { not: activeSessionId } } : {})
      },
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

// Answers every interaction through the interaction itself, in guilds and in
// DMs alike: the bot has no DirectMessages intent, so DM channels are never
// cached and interaction.channel cannot be relied upon there.
async function sendPrivate(interaction: FormInteraction, content: string, components: any[] = []) {
  const payload = { content, components, allowedMentions: NO_MENTIONS };
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply(payload);
  } else if (interaction.replied) {
    await interaction.followUp({ ...payload, ephemeral: interaction.inGuild() });
  } else {
    await interaction.reply({ ...payload, ephemeral: interaction.inGuild() });
  }
}

async function getSession(rawToken: string, userId: string) {
  if (!TOKEN.test(rawToken)) return null;
  return prisma.formSession.findFirst({
    where: { token: rawToken, userId, state: 'ACTIVE', expiresAt: { gt: new Date() } },
    include: { form: true }
  });
}

function selectBounds(question: FormQuestion) {
  if (question.type !== 'MULTI_SELECT') return { min: 1, max: 1 };
  // Same bounds as validateQuestionAnswer, clamped to what Discord accepts.
  const bounds = selectionBounds(question);
  const max = Math.max(1, Math.min(25, bounds.max));
  return { min: Math.max(0, Math.min(max, bounds.min)), max };
}

function promptComponents(sessionToken: string, question: FormQuestion, index: number) {
  const suffix = `${sessionToken}:${index}`;
  const cancelButton = new ButtonBuilder().setCustomId(CANCEL + sessionToken).setLabel('Annulla')
    .setStyle(ButtonStyle.Danger);
  if (question.type === 'SINGLE_SELECT' || question.type === 'MULTI_SELECT') {
    const options = (question.options ?? []).slice(0, 25).map((option) => ({
      label: option.label.slice(0, 100),
      value: option.value.slice(0, 100),
      description: option.description?.slice(0, 100) || undefined
    }));
    const { min, max } = selectBounds(question);
    // An empty answer is valid for every optional select question.
    const skippable = !question.required;
    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SELECT + suffix)
          .setPlaceholder('Seleziona...')
          .setMinValues(min)
          .setMaxValues(max)
          .addOptions(options)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...(skippable
          ? [new ButtonBuilder().setCustomId(SKIP + suffix).setLabel('Salta').setStyle(ButtonStyle.Secondary)]
          : []),
        cancelButton
      )
    ];
  }
  if (question.type === 'BOOLEAN') {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(BOOL + suffix + ':true').setLabel('Sì').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BOOL + suffix + ':false').setLabel('No').setStyle(ButtonStyle.Secondary),
      ...(!question.required
        ? [new ButtonBuilder().setCustomId(BOOL + suffix + ':skip').setLabel('Salta').setStyle(ButtonStyle.Secondary)]
        : []),
      cancelButton
    )];
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(TEXT + suffix).setLabel(question.required ? 'Rispondi' : 'Rispondi / salta')
      .setStyle(ButtonStyle.Primary),
    cancelButton
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
  // A select with exactly one chosen value (or the skip button) arrives as a
  // string; multi-select answers are always arrays.
  const value = question.type === 'MULTI_SELECT' && typeof raw === 'string'
    ? (raw ? [raw] : [])
    : raw;
  const result = validateQuestionAnswer(question, value);
  if (!result.ok) {
    await sendPrivate(interaction, result.message, promptComponents(sessionToken, question, index));
    return;
  }

  const answers = answersFrom(session.answersEncrypted);
  answers.push({ id: question.id, label: question.label, type: question.type, value: result.value });
  // Conditional write: of two concurrent answers to the same step only one
  // advances the session; the other must not append a duplicate.
  const advanced = await prisma.formSession.updateMany({
    where: { id: session.id, state: 'ACTIVE', currentQuestion: index, expiresAt: { gt: new Date() } },
    data: {
      answersEncrypted: encryptText(JSON.stringify(answers)),
      currentQuestion: index + 1,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  });
  if (advanced.count !== 1) {
    await sendPrivate(interaction, 'Questa domanda non è più valida.');
    return;
  }
  await promptQuestion(interaction, sessionToken);
}

// Splits the report so that every message stays below Discord's 6000
// character embed total, 10 embeds per message and 25 fields per embed.
function reportMessages(
  title: string,
  submissionId: string,
  userId: string,
  answers: FormAnswer[],
  questions: FormQuestion[]
) {
  const footer = `Dispatch form - ${submissionId}`;
  const fields = answers.map((answer) => ({
    name: answer.label.slice(0, 256) || 'Domanda',
    value: displayAnswer(answer, questions.find((question) => question.id === answer.id)).slice(0, 1024) ||
      'Nessuna risposta'
  }));
  const messages: EmbedBuilder[][] = [];
  const state = { embeds: [] as EmbedBuilder[], used: 0, fieldCount: 0 };
  const startEmbed = (reserve: number) => {
    const first = !messages.length && !state.embeds.length;
    const embedTitle = first ? title.slice(0, 256) : `${title.slice(0, 230)} - continua`;
    const description = first
      ? (answers.length ? `Compilato da <@${userId}> (\`${userId}\`)` : `Compilato da <@${userId}> senza risposte.`)
      : '';
    const cost = embedTitle.length + description.length + footer.length;
    if (state.embeds.length >= 10 || (state.embeds.length && state.used + cost + reserve > REPORT_MESSAGE_BUDGET)) {
      messages.push(state.embeds);
      state.embeds = [];
      state.used = 0;
    }
    const embed = new EmbedBuilder().setTitle(embedTitle).setFooter({ text: footer }).setTimestamp();
    if (description) embed.setDescription(description);
    state.embeds.push(embed);
    state.used += cost;
    state.fieldCount = 0;
    return embed;
  };

  let embed = startEmbed(0);
  for (const field of fields) {
    const cost = field.name.length + field.value.length;
    if (state.fieldCount >= 25 || state.used + cost > REPORT_MESSAGE_BUDGET) embed = startEmbed(cost);
    embed.addFields(field);
    state.used += cost;
    state.fieldCount++;
  }
  if (state.embeds.length) messages.push(state.embeds);
  return messages;
}

type FormTicketSource = {
  id: string;
  name: string;
  ticketParentCategoryId: string | null;
  ticketStaffRoleIds: string[];
};

// Mirrors createTicket in tickets.ts: the reservation guards blacklist,
// open-ticket limits and anti-spam; an uncertain Discord mutation keeps the
// reservation in CREATING instead of risking a duplicate channel.
async function createFormTicket(
  interaction: FormInteraction,
  guild: Guild,
  form: FormTicketSource,
  category: TicketCategory,
  userId: string,
  answers: FormAnswer[],
  questions: FormQuestion[],
  submissionId: string,
  reports: EmbedBuilder[][],
  reservationToken: string
) {
  const guildId = guild.id;
  if (!(await consumeTicketOpenReservation(guildId, userId, reservationToken))) return null;
  // Staff actions authorize against the category roles, so the form override
  // can only add roles, never drop the category staff.
  const staffRoleIds = [...new Set([...category.staffRoleIds, ...form.ticketStaffRoleIds])];
  const formAnswers = answers.map((answer) => ({
    id: answer.id,
    label: answer.label,
    value: displayAnswer(answer, questions.find((question) => question.id === answer.id))
  }));
  let channel: TextChannel | undefined;
  let persisted = false;
  let discordRequestStarted = false;
  try {
    const counter = await prisma.guildSettings.update({
      where: { guildId },
      data: { ticketCounter: { increment: 1 } },
      select: { ticketCounter: true }
    });
    const number = counter.ticketCounter;
    const participant = [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks
    ];
    discordRequestStarted = true;
    channel = await guild.channels.create({
      name: `ticket-${String(number).padStart(4, '0')}-${safeChannelPart(interaction.user.username)}`,
      type: ChannelType.GuildText,
      parent: form.ticketParentCategoryId ?? category.discordCategoryId ?? undefined,
      topic: `Dispatch ticket #${number} - ${userId} - form ${form.name}`.slice(0, 1024),
      permissionOverwrites: [
        { id: guildId, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.CreatePublicThreads,
          PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads] },
        { id: interaction.client.user!.id, type: 1, allow: [...participant, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
        { id: userId, type: 1, allow: participant },
        ...staffRoleIds.map((id) => ({
          id, type: 0 as const, allow: [...participant, PermissionFlagsBits.ManageMessages]
        }))
      ]
    });
    const createdChannel = channel;
    const ticket = await commitTicketOpen(guildId, userId, reservationToken, (tx) => tx.ticket.create({
      data: {
        guildId,
        categoryId: category.id,
        ticketNumber: number,
        openerId: userId,
        channelId: createdChannel.id,
        status: 'OPEN',
        // Closed-category override of the form (ticketClosedParentCategoryId).
        sourceFormId: form.id,
        formDataEncrypted: formAnswers.length ? encryptText(JSON.stringify(formAnswers)) : null,
        lastActivityAt: new Date(),
        members: { create: { userId, access: 'OPENER' } },
        audit: { create: {
          guildId,
          actorId: userId,
          action: 'ticket.open.from_form',
          details: { formId: form.id, submissionId, categoryId: category.id, formFieldCount: formAnswers.length }
        } }
      }
    }));
    persisted = true;
    const pings = staffRoleIds.slice(0, 50);
    try {
      await createdChannel.send({
        content: [
          pings.map((id) => `<@&${id}>`).join(' '),
          `Ticket #${number} aperto da <@${userId}> tramite il form **${form.name.slice(0, 100)}**.`
        ].filter(Boolean).join('\n'),
        components: [ticketControls(ticket.id)],
        allowedMentions: { parse: [], roles: pings, users: [] }
      });
      for (const embeds of reports) {
        await createdChannel.send({ embeds, allowedMentions: NO_MENTIONS });
      }
    } catch {
      await prisma.ticketAudit.create({ data: {
        ticketId: ticket.id, guildId, actorId: null, action: 'ticket.introduction.failed', details: {}
      } }).catch(() => null);
    }
    await logTicketEvent(interaction.client, guildId, 'TICKET_OPEN', {
      title: 'Ticket aperto da un form',
      ticket,
      actorId: userId,
      categoryName: category.name,
      fields: [
        { name: 'Form', value: form.name, inline: true },
        { name: 'Invio', value: submissionId, inline: true }
      ]
    });
    return createdChannel.id;
  } catch (error) {
    if (!persisted) {
      let safeToRelease = !discordRequestStarted;
      if (channel) {
        safeToRelease = await channel.delete('Dispatch: failed form ticket persistence').then(() => true)
          .catch((failure: { code?: number }) => failure.code === 10003);
      } else if (discordRequestStarted) {
        const status = (error as { status?: number }).status;
        safeToRelease = status !== undefined && status >= 400 && status < 500 && status !== 429;
      }
      if (safeToRelease) await releaseTicketOpenReservation(guildId, userId, reservationToken);
    }
    throw error;
  }
}

async function finalizeSubmission(interaction: FormInteraction, sessionToken: string) {
  // Report delivery and ticket creation take longer than Discord's 3 second
  // acknowledgement window.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: interaction.inGuild() });
  }
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

  // The ticket opening is reserved before anything is stored: a user who may
  // not open a ticket (blacklist, open limit, cooldown, anti-spam) gets no
  // submission either.
  const wantsTicket = session.form.createTicketOnSubmit && Boolean(session.form.ticketCategoryId);
  const category = wantsTicket
    ? await prisma.ticketCategory.findFirst({
      where: { id: session.form.ticketCategoryId!, guildId: session.guildId, enabled: true }
    })
    : null;
  let reservationToken: string | null = null;
  if (category) {
    const reservation = await reserveTicketOpen(session.guildId, session.userId, category.id,
      'f_' + session.formId, formVersion(category.formFields));
    if (!reservation.ok) {
      // Temporary refusals keep the answers: pressing the panel button again
      // resumes the session and retries the submission.
      const temporary = ['GLOBAL_COOLDOWN', 'CATEGORY_COOLDOWN', 'TICKET_OPEN_IN_PROGRESS', 'MAX_OPEN_TICKETS']
        .includes(reservation.code);
      if (!temporary) {
        await prisma.formSession.updateMany({ where: { id: session.id, state: 'ACTIVE' }, data: { state: 'CANCELLED' } });
      }
      await sendPrivate(interaction, ticketOpenReservationMessage(reservation) +
        (temporary ? ' Le tue risposte restano salvate: premi di nuovo il pulsante del form per riprovare.' : ''));
      return;
    }
    reservationToken = reservation.token;
  }

  let submission: { id: string };
  try {
    submission = await prisma.$transaction(async (tx) => {
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
  } catch (error) {
    if (reservationToken) await releaseTicketOpenReservation(session.guildId, session.userId, reservationToken);
    if (error instanceof Error && error.message === 'FORM_SESSION_ALREADY_USED') {
      await sendPrivate(interaction, 'Questa compilazione è scaduta o è già stata inviata.');
      return;
    }
    throw error;
  }

  // From here on the submission exists: every remaining step is best-effort
  // and the session always ends COMPLETED instead of staying SUBMITTING.
  let reportChannelId: string | null = null;
  let reportMessageId: string | null = null;
  let ticketChannelId: string | null = null;
  let ticketFailed = wantsTicket && !category;
  const reports = reportMessages(session.form.name, submission.id, session.userId, answers, questions);

  if (session.form.resultChannelId) {
    try {
      const channel = await guild.channels.fetch(session.form.resultChannelId);
      if (!channel?.isTextBased() || !('send' in channel)) throw new Error('FORM_RESULT_CHANNEL_INVALID');
      for (const [index, embeds] of reports.entries()) {
        const first = index === 0;
        const message = await channel.send({
          content: first ? session.form.resultRoleIds.map((id) => `<@&${id}>`).join(' ') || undefined : undefined,
          embeds,
          allowedMentions: first ? { parse: [], roles: session.form.resultRoleIds, users: [] } : NO_MENTIONS
        });
        if (first) {
          reportChannelId = channel.id;
          reportMessageId = message.id;
        }
      }
    } catch (error) {
      log.warn({ ...errorInfo(error), guildId: session.guildId, formId: session.formId, submissionId: submission.id },
        'Form report delivery failed');
    }
  }

  if (category && reservationToken) {
    try {
      ticketChannelId = await createFormTicket(interaction, guild, session.form, category, session.userId,
        answers, questions, submission.id, reports, reservationToken);
      if (!ticketChannelId) ticketFailed = true;
    } catch (error) {
      ticketFailed = true;
      log.error({ ...errorInfo(error), guildId: session.guildId, formId: session.formId, submissionId: submission.id },
        'Form ticket creation failed');
    }
  } else if (ticketFailed) {
    log.warn({ guildId: session.guildId, formId: session.formId, submissionId: submission.id },
      'Form ticket category missing or disabled');
  }

  try {
    await prisma.$transaction([
      prisma.formSubmission.update({
        where: { id: submission.id },
        data: { reportChannelId, reportMessageId, ticketChannelId }
      }),
      prisma.formSession.update({ where: { id: session.id }, data: { state: 'COMPLETED' } })
    ]);
  } catch (error) {
    log.error({ ...errorInfo(error), guildId: session.guildId, formId: session.formId, submissionId: submission.id },
      'Form submission finalization failed');
    await prisma.formSession.updateMany({ where: { id: session.id }, data: { state: 'COMPLETED' } }).catch(() => null);
  }

  // Never the answers: they are encrypted and stay in the submission.
  await logTicketEvent(interaction.client, session.guildId, 'FORM_SUBMISSION', {
    title: 'Form inviato',
    actorId: session.userId,
    fields: [
      { name: 'Form', value: session.form.name, inline: true },
      { name: 'Utente', value: userMention(session.userId), inline: true },
      { name: 'Invio', value: submission.id, inline: true },
      ...(ticketChannelId ? [{ name: 'Ticket', value: `<#${ticketChannelId}>`, inline: true }] : []),
      ...(ticketFailed ? [{ name: 'Ticket', value: 'Creazione non riuscita', inline: true }] : [])
    ]
  });

  await sendPrivate(
    interaction,
    'Form inviato correttamente.' +
      (ticketChannelId ? ` È stato creato <#${ticketChannelId}>.` : '') +
      (ticketFailed ? ' Non è stato possibile creare il ticket associato: contatta lo staff.' : '')
  );
}

async function deliverQuestion(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  deliveryMode: string,
  session: { id: string; token: string },
  questions: FormQuestion[],
  index: number,
  resumed: boolean
) {
  const question = questions[index]!;
  const content = questionDescription(question, index, questions.length);
  const components = promptComponents(session.token, question, index);
  if (deliveryMode !== 'DM') {
    await sendPrivate(interaction, content, components);
    return;
  }
  // The DM goes out first: only a delivered DM may be confirmed to the user.
  const delivered = await interaction.user.createDM()
    .then((dm) => dm.send({ content, components, allowedMentions: NO_MENTIONS }))
    .then(() => true, () => false);
  if (!delivered) {
    await prisma.formSession.updateMany({ where: { id: session.id, state: 'ACTIVE' }, data: { state: 'CANCELLED' } });
    await sendPrivate(interaction,
      'Non riesco a inviarti messaggi privati. Abilita i messaggi diretti da questo server e premi di nuovo il pulsante.');
    return;
  }
  await sendPrivate(interaction, resumed
    ? 'Hai già una compilazione in corso: ti ho inviato di nuovo la domanda corrente in privato.'
    : 'Ti ho inviato il form in privato.');
}

// The forms a panel offers, in order. Rows written before multi-form panels
// may only carry the primary formId.
const panelFormIds = (panel: { formId: string; formIds: string[] }) =>
  panel.formIds.length ? panel.formIds : [panel.formId];

async function beginForm(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  panelId: string,
  requestedFormId: string | null
) {
  if (!interaction.guildId || !interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  if (!CUID.test(panelId) || (requestedFormId !== null && !CUID.test(requestedFormId))) {
    await sendPrivate(interaction, 'Questo form non è disponibile.');
    return;
  }
  const panel = await prisma.formPanel.findFirst({
    where: {
      id: panelId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: interaction.message.id,
      enabled: true
    }
  });
  const offered = panel ? panelFormIds(panel) : [];
  const formId = requestedFormId ?? offered[0];
  // The form must still be offered by this panel and belong to this guild.
  const form = panel && formId && offered.includes(formId)
    ? await prisma.formDefinition.findFirst({ where: { id: formId, guildId: interaction.guildId } })
    : null;
  if (!panel || !form || !isOpen(form)) {
    await sendPrivate(interaction, 'Questo form non è disponibile.');
    return;
  }
  const questions = normalizeQuestions(form.questions);
  if (!questions.length) {
    await sendPrivate(interaction, 'Questo form non contiene domande valide.');
    return;
  }

  // Expired sessions would otherwise stay ACTIVE and block the partial unique
  // index on (formId, userId).
  const now = new Date();
  await prisma.formSession.updateMany({
    where: { formId: form.id, userId: interaction.user.id, state: 'ACTIVE', expiresAt: { lte: now } },
    data: { state: 'EXPIRED' }
  });
  const existing = await prisma.formSession.findFirst({
    where: {
      guildId: interaction.guildId, formId: form.id, userId: interaction.user.id,
      state: 'ACTIVE', expiresAt: { gt: now }
    }
  });
  if (existing) {
    if (!questions[existing.currentQuestion]) {
      await finalizeSubmission(interaction, existing.token);
      return;
    }
    await deliverQuestion(interaction, form.deliveryMode, existing, questions, existing.currentQuestion, true);
    return;
  }

  const permission = await canSubmit(interaction.guildId, interaction.user.id, form, interaction.client);
  if (!permission.ok) {
    await sendPrivate(interaction, permission.message);
    return;
  }

  let session: { id: string; token: string };
  try {
    session = await prisma.formSession.create({ data: {
      guildId: interaction.guildId,
      formId: form.id,
      userId: interaction.user.id,
      token: token(),
      source: sourceKey(panel.id),
      channelId: interaction.channelId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    } });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      await sendPrivate(interaction, 'Hai già una compilazione in corso.');
      return;
    }
    throw error;
  }

  await deliverQuestion(interaction, form.deliveryMode, session, questions, 0, false);
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

async function skipAnswer(interaction: ButtonInteraction) {
  const raw = interaction.customId.slice(SKIP.length);
  const [sessionToken, indexRaw] = raw.split(':');
  const index = Number(indexRaw);
  if (!sessionToken || !Number.isInteger(index)) return;
  // validateQuestionAnswer rejects the empty answer for required questions.
  await storeAnswer(interaction, sessionToken, index, '');
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
    where: { id: panelId, guildId, enabled: true }
  });
  if (!panel) throw new Error('FORM_PANEL_NOT_FOUND');

  const ids = panelFormIds(panel);
  const rows = await prisma.formDefinition.findMany({ where: { guildId, id: { in: ids } } });
  // Panel order; ids that are not forms of this guild are ignored.
  const forms = ids
    .map((id) => rows.find((form) => form.id === id))
    .filter((form): form is (typeof rows)[number] => Boolean(form))
    .slice(0, 25);
  if (!forms.length) throw new Error('PANEL_HAS_NO_ITEMS');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('GUILD_NOT_FOUND');
  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('FORM_PANEL_CHANNEL_INVALID');

  const style = panelStyle(panel.style, 'BUTTONS');
  const single = forms.length === 1 ? forms[0]! : null;
  const payload = {
    allowedMentions: NO_MENTIONS,
    embeds: [panelEmbed(
      { ...panel, description: panel.description || single?.description || null },
      style === 'SELECT' ? 'Scegli il form da compilare.' : 'Premi il pulsante per compilare il form.'
    )],
    components: panelComponents({
      style,
      placeholder: panel.placeholder,
      defaultPlaceholder: 'Scegli un form',
      items: panel.items,
      // A one-form button panel keeps its historical button label.
      entries: forms.map((form) => ({
        id: form.id,
        label: style === 'BUTTONS' && single ? panel.buttonLabel : form.name,
        description: form.description
      })),
      selectCustomId: PICK + panel.id,
      buttonCustomId: (formId) => START + panel.id + ':' + formId
    })
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
  return [START, PICK, TEXT, TEXT_MODAL, SELECT, BOOL, SKIP, CANCEL].some((prefix) => customId.startsWith(prefix));
}

export async function handleFormInteraction(interaction: FormInteraction) {
  if (interaction.isButton() && interaction.customId.startsWith(START)) {
    const [panelId = '', formId, extra] = interaction.customId.slice(START.length).split(':');
    if (extra !== undefined) return;
    return beginForm(interaction, panelId, formId ?? null);
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(PICK)) {
    return beginForm(interaction, interaction.customId.slice(PICK.length), interaction.values[0] ?? '');
  }
  if (interaction.isButton() && interaction.customId.startsWith(TEXT)) return openTextModal(interaction);
  if (interaction.isModalSubmit() && interaction.customId.startsWith(TEXT_MODAL)) return submitText(interaction);
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SELECT)) return selectAnswer(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(BOOL)) return boolAnswer(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(SKIP)) return skipAnswer(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(CANCEL)) return cancel(interaction);
}
