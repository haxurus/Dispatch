import { Client, Events, GatewayIntentBits } from 'discord.js';
import pino from 'pino';
import { prisma } from '@dispatch/db';
import { config } from './config.js';
import { startInternalApi } from './internal-api.js';
import { handleTicketInteraction } from './tickets.js';
import {
  recordTicketMessage,
  runTicketAutomations
} from './ticket-operations.js';
import { runTicketRetention } from './retention.js';

const log = pino({ level: config.logLevel });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function ensureGuild(guild: { id: string; name: string }) {
  await prisma.guildSettings.upsert({
    where: { guildId: guild.id },
    update: { guildName: guild.name },
    create: { guildId: guild.id, guildName: guild.name }
  });
}

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
    await ensureGuild(guild).catch((error) => log.error({ err: error, guildId: guild.id }, 'Guild sync failed'));
  }

  internalApi = startInternalApi(client, config.internalApiKey, config.internalApiPort);
  void runRetentionCycle();
});

client.on(Events.GuildCreate, async (guild) => {
  await ensureGuild(guild).catch((error) => log.error({ err: error, guildId: guild.id }, 'Guild sync failed'));
  log.info({ guildId: guild.id, guildName: guild.name }, 'Dispatch joined guild');
});

client.on(Events.GuildUpdate, async (_oldGuild, newGuild) => {
  await ensureGuild(newGuild).catch((error) => log.error({ err: error, guildId: newGuild.id }, 'Guild sync failed'));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return;

  try {
    await handleTicketInteraction(interaction);
  } catch (error) {
    log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Ticket interaction failed');

    const message = 'Si è verificato un errore durante la gestione del ticket.';
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
