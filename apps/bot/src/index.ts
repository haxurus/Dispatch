import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import pino from 'pino';
import { prisma } from '@dispatch/db';
import { config } from './config.js';
import { startInternalApi } from './internal-api.js';
import { handleTicketInteraction } from './tickets.js';
import { handleFormInteraction, isFormInteraction } from './forms.js';
import {
  recordTicketMessage,
  runTicketAutomations
} from './ticket-operations.js';
import { runTicketRetention } from './retention.js';
import { runLeaderboardCycle } from './leaderboard.js';
import { checkInstall, isGuildInstallBlocked } from './install-guard.js';
import { createStatusNotifier, guildFields } from './status.js';

const log = pino({ level: config.logLevel });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  // Custom status in the member list: points people who see the bot to the site.
  presence: config.statusText
    ? { activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: config.statusText }] }
    : undefined
});

const status = createStatusNotifier(client);

// The bot is (again) in this guild: a pending post-removal purge is cancelled.
async function ensureGuild(guild: { id: string; name: string }) {
  await prisma.guildSettings.upsert({
    where: { guildId: guild.id },
    update: { guildName: guild.name, leftAt: null },
    create: { guildId: guild.id, guildName: guild.name }
  });
}

// Starts the post-removal retention (the API purges after 30 days).
async function markGuildLeft(guildIds: string[]) {
  if (!guildIds.length) return 0;
  const result = await prisma.guildSettings.updateMany({
    where: { guildId: { in: guildIds }, leftAt: null },
    data: { leftAt: new Date() }
  });
  return result.count;
}

// Servers the bot leaves on purpose (blocked installs): their GuildDelete is not news.
const intentionalLeaves = new Set<string>();

let internalApi: ReturnType<typeof startInternalApi> | null = null;
let retentionRunning = false;

async function runRetentionCycle() {
  if (retentionRunning) return;
  retentionRunning = true;
  try {
    const result = await runTicketRetention(client);
    if (result.transcriptsDeleted || result.ticketsDeleted || result.channelsDeleted || result.failed) {
      log.info(result, 'Ticket retention cycle completed');
    }
  } catch (error) {
    log.error({ err: error }, 'Ticket retention cycle failed');
  } finally {
    retentionRunning = false;
  }
}

client.once(Events.ClientReady, async (ready) => {
  log.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'Dispatch bot ready');

  // A transient DB error on one guild must not leave the bot without its RPC API.
  for (const guild of ready.guilds.cache.values()) {
    // Guilds blocked while the bot was offline are left at startup.
    const blocked = await isGuildInstallBlocked(guild.id).catch(() => false);
    if (blocked) {
      intentionalLeaves.add(guild.id);
      await guild.leave()
        .then(() => log.warn({ guildId: guild.id }, 'Left blocked guild at startup'))
        .catch((error) => log.error({ err: error, guildId: guild.id }, 'Unable to leave blocked guild'));
      continue;
    }
    await ensureGuild(guild).catch((error) => log.error({ err: error, guildId: guild.id }, 'Guild sync failed'));
  }

  // Servers that removed the bot while it was offline (unavailable guilds
  // stay in the cache, so an outage never starts the purge clock).
  const known = new Set(ready.guilds.cache.filter((guild) => !intentionalLeaves.has(guild.id)).keys());
  const stored = await prisma.guildSettings.findMany({ where: { leftAt: null }, select: { guildId: true } })
    .catch(() => [] as Array<{ guildId: string }>);
  const departed = await markGuildLeft(stored.map((row) => row.guildId).filter((guildId) => !known.has(guildId)))
    .catch((error) => { log.error({ err: error }, 'Unable to mark departed guilds'); return 0; });

  internalApi = startInternalApi(client, config.internalApiKey, config.internalApiPort, status);
  status.notify({
    level: 'ok',
    title: 'Dispatch online',
    dedupeKey: 'startup',
    fields: [
      { name: 'Server', value: String(ready.guilds.cache.size) },
      ...(departed ? [{ name: 'Rimosso mentre era offline', value: String(departed) }] : [])
    ]
  });
  void runRetentionCycle();
  void runLeaderboards();
});

client.on(Events.GuildCreate, async (guild) => {
  // Installation blacklist (super console): leave before creating any state.
  let installerId: string | null = null;
  try {
    const check = await checkInstall(guild, client.user?.id ?? null);
    installerId = check.installerId;
    if (check.verdict !== 'allowed') {
      intentionalLeaves.add(guild.id);
      setTimeout(() => intentionalLeaves.delete(guild.id), 120_000).unref();
      await guild.leave();
      log.warn({ guildId: guild.id, reason: check.verdict }, 'Left guild: installation blocked');
      status.notify({
        level: 'warn',
        title: 'Installazione rifiutata',
        description: `Dispatch è uscito da **${guild.name}**: ${check.verdict === 'blocked-guild' ? 'il server è in blacklist' : 'chi ha aggiunto il bot è in blacklist'}.`,
        fields: guildFields(guild, installerId)
      });
      return;
    }
  } catch (error) {
    log.error({ err: error, guildId: guild.id }, 'Install block check failed');
  }

  await ensureGuild(guild).catch((error) => log.error({ err: error, guildId: guild.id }, 'Guild sync failed'));
  log.info({ guildId: guild.id, guildName: guild.name }, 'Dispatch joined guild');
  status.notify({ level: 'ok', title: 'Dispatch aggiunto a un server', fields: guildFields(guild, installerId) });
});

client.on(Events.GuildDelete, async (guild) => {
  // Removed, kicked or the server was deleted: start the post-removal retention.
  await markGuildLeft([guild.id]).catch((error) => log.error({ err: error, guildId: guild.id }, 'Unable to mark guild as left'));
  if (intentionalLeaves.delete(guild.id)) return;
  log.info({ guildId: guild.id }, 'Dispatch removed from guild');
  status.notify({ level: 'info', title: 'Dispatch rimosso da un server', fields: guildFields(guild) });
});

client.on(Events.GuildUpdate, async (_oldGuild, newGuild) => {
  await ensureGuild(newGuild).catch((error) => log.error({ err: error, guildId: newGuild.id }, 'Guild sync failed'));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return;

  try {
    if (isFormInteraction(interaction.customId)) await handleFormInteraction(interaction);
    else await handleTicketInteraction(interaction);
  } catch (error) {
    log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Ticket interaction failed');

    const message = 'Si è verificato un errore durante la gestione della richiesta.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => null);
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await recordTicketMessage(message);
  } catch (error) {
    log.error({ err: error, channelId: message.channelId }, 'Ticket activity tracking failed');
  }
});

let automationRunning = false;
setInterval(() => {
  if (automationRunning) return;
  automationRunning = true;
  void runTicketAutomations(client)
    .catch((error) => {
      log.error({ err: error }, 'Ticket automation cycle failed');
    })
    .finally(() => {
      automationRunning = false;
    });
}, 60_000).unref();

setInterval(() => {
  void runRetentionCycle();
}, 6 * 60 * 60 * 1000).unref();

// Moderator leaderboard: no overlapping cycles, per-guild errors are isolated
// inside runLeaderboardCycle.
let leaderboardRunning = false;
async function runLeaderboards() {
  if (leaderboardRunning || !client.isReady()) return;
  leaderboardRunning = true;
  try {
    const result = await runLeaderboardCycle(client);
    if (result.posted || result.failed) log.info(result, 'Leaderboard cycle completed');
  } catch (error) {
    log.error({ err: error }, 'Leaderboard cycle failed');
  } finally {
    leaderboardRunning = false;
  }
}

setInterval(() => {
  void runLeaderboards();
}, 15 * 60 * 1000).unref();

client.on(Events.Warn, (warning) => log.warn({ warning }, 'Discord client warning'));
client.on(Events.Error, (error) => log.error({ err: error }, 'Discord client error'));

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Shutting down');
  client.destroy();
  if (internalApi) {
    await new Promise<void>((resolve) => internalApi!.close(() => resolve()));
  }
  await prisma.$disconnect();
  process.exit(0);
};

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  log.fatal({ err: error }, 'Uncaught exception');
  process.exit(1);
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await client.login(config.discordToken);
