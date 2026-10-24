import { type Client, EmbedBuilder } from 'discord.js';
import type { Task } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';

const BUMP_INTERVAL_MS = 2 * 60 * 60 * 1000;

/** The task ticks once a minute, so a bump is "due" for exactly one tick. */
const REMINDER_WINDOW_MS = 60 * 1000;

async function bumpReminderTask(client: Client): Promise<void> {
  const redis = getRedisClient();

  try {
    Logging.trace('Checking if servers can be bumped again!');

    let guilds: any[];
    const cachedData = await redis.get('bumpReminderSettings');

    if (cachedData) {
      guilds = JSON.parse(cachedData);
    } else {
      guilds = await prisma.bumpReminderSettings.findMany({
        where: {
          enabled: 1,
        },
      });
      await redis.set('bumpReminderSettings', JSON.stringify(guilds), 'EX', 180);
    }

    for (const guild of guilds) {
      try {
        if (!guild.channel) continue;

        const lastBumpTime = await getLastBumpTime(guild.guildId);
        if (lastBumpTime === null) continue;

        const elapsed = Date.now() - lastBumpTime;

        // Too early, or the moment has already gone by — in both cases: post nothing.
        if (elapsed < BUMP_INTERVAL_MS) continue;
        if (elapsed >= BUMP_INTERVAL_MS + REMINDER_WINDOW_MS) continue;

        // Keyed on the bump itself, so overlapping ticks (or a second bot instance)
        // cannot remind twice for the same bump, while the next bump still gets its
        // own reminder.
        const claimed = await redis.set(
          `bump_reminder_sent:${guild.guildId}:${lastBumpTime}`,
          '1',
          'EX',
          600,
          'NX'
        );
        if (!claimed) continue;

        const channel = await client.channels.fetch(guild.channel as string);
        if (!channel?.isSendable()) continue;

        if (guild.messageType === 'text') {
          await channel.send({ content: guild.message });
        } else {
          const embed = new EmbedBuilder();

          if (guild.embed.color) embed.setColor(guild.embed.color);
          if (guild.embed.title) embed.setTitle(guild.embed.title);
          if (guild.embed.titleUrl) embed.setURL(guild.embed.titleUrl);
          if (guild.embed.description) embed.setDescription(guild.embed.description);

          if (guild.embed.author?.name) {
            embed.setAuthor({
              name: guild.embed.author.name,
              iconURL: guild.embed.author.icon || undefined,
            });
          }

          if (guild.embed.thumbnail) embed.setThumbnail(guild.embed.thumbnail);
          if (guild.embed.image) embed.setImage(guild.embed.image);

          if (guild.embed.fields?.length) {
            embed.addFields(
              guild.embed.fields
                .filter((f: { name: any; value: any }) => f.name && f.value)
                .map((f: { name: any; value: any; inline: any }) => ({
                  name: f.name,
                  value: f.value,
                  inline: f.inline ?? false,
                }))
            );
          }

          await channel.send({ embeds: [embed] });
        }
      } catch (error: any) {
        if (error?.code === 10003) {
          await prisma.bumpReminderSettings.delete({
            where: { guildId: guild.guildId },
          });

          await redis.del('bumpReminderSettings');

          Logging.warn(`Removed bump reminder for guild ${guild.guildId} due to unknown channel`);
          continue;
        }
        Logging.error(`Error in bump reminder tasks: ${error}`);
      }
    }
  } catch (error) {
    Logging.warn(`Error in bump reminder tasks: ${error}`);
  }
}

/** Most recent bump in the bumps table for this guild, in ms, or null if there is none. */
async function getLastBumpTime(guildId: string): Promise<number | null> {
  const lastBump = await prisma.bumps.findFirst({
    where: { guildId },
    orderBy: { bumpedAt: 'desc' },
    select: { bumpedAt: true },
  });

  return lastBump ? lastBump.bumpedAt.getTime() : null;
}

export default {
  name: 'bump-reminder',
  schedule: '* * * * *',

  async execute(client) {
    await bumpReminderTask(client);
  },
} satisfies Task;
