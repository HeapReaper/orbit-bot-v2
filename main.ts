import 'dotenv/config';
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Options,
  Partials,
  type Interaction,
} from 'discord.js';
import cron from 'node-cron';
import express from 'express';
import cors from 'cors';
import * as Sentry from '@sentry/node';
import type { Command, Component, ComponentInteraction } from './types';
import { loadApiRoutes, loadCommands, loadComponents, loadEvents, loadTasks } from './lib/handlers';
import { Logging } from './lib/logging';
import { prisma } from './lib/prisma';
import { disconnectRedis } from './lib/redis';
import { flushInflux } from './lib/influx';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}

// Registered once, at the top level. v1 added these inside the ready handler.
process.on('unhandledRejection', (reason) => {
  Logging.error(`[UNHANDLED REJECTION] ${reason instanceof Error ? reason.stack : reason}`);
});

process.on('uncaughtException', (error) => {
  Logging.error(`[UNCAUGHT EXCEPTION] ${error.stack ?? error}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.AutoModerationExecution,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],
  // v1 kept discord.js' unbounded defaults: every message, member, user and
  // presence it ever saw stayed in memory. The caches below are capped and
  // swept so memory stays flat over time; handlers fetch what is missing.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 100,
    GuildMemberManager: {
      maxSize: 1000,
      // The bot's own member is needed for permission checks everywhere, and
      // members in voice are read from the cache by the leveling voice XP task.
      keepOverLimit: (member) => member.id === member.client.user.id || !!member.voice.channelId,
    },
    UserManager: {
      maxSize: 5000,
      keepOverLimit: (user) => user.id === user.client.user.id,
    },
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: {
      interval: 900, // every 15 minutes
      lifetime: 3600, // drop messages older than an hour
    },
    users: {
      interval: 3600,
      filter: () => (user) => user.id !== user.client.user.id,
    },
    guildMembers: {
      interval: 3600,
      filter: () => (member) => member.id !== member.client.user.id && !member.voice.channelId,
    },
    threads: {
      interval: 3600,
      lifetime: 14400,
    },
    // Presences only matter for the ServerStats online count, which fetches
    // them fresh before counting; the gateway would otherwise keep one per
    // online member of every guild forever.
    presences: {
      interval: 900,
      filter: () => () => true,
    },
  },
});

// Commands
const commands = new Map<string, Command<any>>();

for (const { file, value } of await loadCommands()) {
  if (commands.has(value.data.name)) {
    Logging.warn(`Duplicate command "${value.data.name}" in ${file}, ignoring it`);
    continue;
  }
  commands.set(value.data.name, value);
}

Logging.info(`Loaded ${commands.size} command(s)`);

// Buttons, select menus and modals
const components: Component[] = (await loadComponents()).map(({ value }) => value);

Logging.info(`Loaded ${components.length} component handler(s)`);

function findComponent(customId: string): Component | undefined {
  return components.find((component) =>
    typeof component.customId === 'string'
      ? component.customId === customId
      : component.customId.test(customId)
  );
}

// Events
const events = await loadEvents();

// Several features listen to the same event (messageCreate has over ten), which
// is by design. Raise the limit to exactly what is registered, so the warning
// still fires if listeners ever start piling up at runtime.
const listenersPerEvent = new Map<string, number>();
for (const { value: event } of events) {
  listenersPerEvent.set(event.name, (listenersPerEvent.get(event.name) ?? 0) + 1);
}
client.setMaxListeners(Math.max(10, ...listenersPerEvent.values()) + 2);

for (const { file, value: event } of events) {
  // Every handler is wrapped, so a throwing handler is logged with its file
  // instead of surfacing as an anonymous unhandled rejection.
  const listener = async (...args: unknown[]) => {
    try {
      await (event.execute as (...args: unknown[]) => unknown)(...args);
    } catch (error) {
      Logging.error(
        `Event ${event.name} (${file}) failed: ${error instanceof Error ? error.stack : error}`
      );
    }
  };

  if (event.once) client.once(event.name, listener);
  else client.on(event.name, listener);
}

Logging.info(`Loaded ${events.length} event handler(s)`);

// Interaction routing
async function replyWithError(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;

  const payload = {
    content: 'There was an error while executing this interaction!',
    flags: MessageFlags.Ephemeral,
  } as const;

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => null);
  } else {
    await interaction.reply(payload).catch(() => null);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        Logging.warn(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      await command.execute(interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      await commands.get(interaction.commandName)?.autocomplete?.(interaction);
      return;
    }

    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
      // No match is fine: collectors on a message handle their own components.
      await findComponent(interaction.customId)?.execute(interaction as ComponentInteraction);
    }
  } catch (error) {
    const label =
      'commandName' in interaction
        ? interaction.commandName
        : 'customId' in interaction
          ? interaction.customId
          : 'unknown';

    Logging.error(`Interaction ${label} failed: ${error instanceof Error ? error.stack : error}`);
    await replyWithError(interaction);
  }
});

// Startup that needs a ready client: tasks, the API and the presence rotation
client.once(Events.ClientReady, async (readyClient) => {
  for (const { file, value: task } of await loadTasks()) {
    const run = async () => {
      Logging.trace(`Running task ${task.name}`);

      try {
        await task.execute(readyClient);
      } catch (error) {
        Logging.error(
          `Task ${task.name} (${file}) failed: ${error instanceof Error ? error.stack : error}`
        );
      }
    };

    // noOverlap: a slow run is skipped instead of piling up concurrent runs
    cron.schedule(task.schedule, run, {
      name: task.name,
      noOverlap: true,
      ...(task.timezone ? { timezone: task.timezone } : {}),
    });
    if (task.runOnStart) void run();

    Logging.debug(`Loaded task: ${task.name} (${task.schedule})`);
  }

  const app = express();

  const allowedOrigins = ['http://localhost:3000', 'https://botinorbit.com'];

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true);
        else callback(new Error('Not allowed by CORS'));
      },
    })
  );

  app.get('/health', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send('OK');
  });

  for (const { file, value: registerRoutes } of await loadApiRoutes()) {
    try {
      registerRoutes(app, readyClient);
    } catch (error) {
      Logging.error(`Failed to register API routes from ${file}: ${error}`);
    }
  }

  const port = Number(process.env.API_PORT ?? 3144);
  app.listen(port, () => Logging.info(`API running at http://localhost:${port}`));

  const activities = [
    () => ({ name: 'botinorbit.com', type: ActivityType.Playing }),
    () => ({ name: '/help', type: ActivityType.Listening }),
    () => ({ name: `In ${readyClient.guilds.cache.size} servers!`, type: ActivityType.Competing }),
  ];
  let activityIndex = 0;

  setInterval(() => {
    const activity = activities[activityIndex]!();
    readyClient.user.setActivity(activity.name, { type: activity.type });
    activityIndex = (activityIndex + 1) % activities.length;
  }, 7000);

  Logging.info(`Client ready! Logged in as ${readyClient.user.tag}`);
});

async function shutdown(signal: string): Promise<void> {
  Logging.info(`Received ${signal}, shutting down`);

  await flushInflux();
  await client.destroy();
  await prisma.$disconnect().catch(() => null);
  await disconnectRedis().catch(() => null);

  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await client.login(process.env.DISCORD_TOKEN).catch((error) => {
  Logging.error(`Could not log in: ${error}`);
  process.exit(1);
});
