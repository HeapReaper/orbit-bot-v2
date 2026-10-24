import { type Client, EmbedBuilder } from 'discord.js';
import type { Task } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';

const BUMP_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Lifetime of the "already reminded" claim. Long enough that a guild which never bumps
 * again is not nagged a second time, short enough to expire on its own.
 */
const REMINDER_CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60;

async function bumpReminderTask(client: Client): Promise<void> {
  const redis = getRedisClient();

  try {
    Logging.trace('Checking if servers can be DH-bumped again!');

    let guilds: any[];
    const cachedData = await redis.get('dhBumpReminderSettings');

    if (cachedData) {
      guilds = JSON.parse(cachedData);
    } else {
      guilds = await prisma.dhBumpReminderSettings.findMany({
        where: {
          enabled: 1,
        },
      });
      await redis.set('dhBumpReminderSettings', JSON.stringify(guilds), 'EX', 180);
    }

    for (const guild of guilds) {
      try {
        if (!guild.channel) {
          Logging.debug(
            `DhBumper: guild ${guild.guildId} has the reminder enabled but no channel configured, skipping.`
          );
          continue;
        }

        const lastBumpTime = await getLastBumpTime(guild.guildId);
        if (lastBumpTime === null) continue;

        if (Date.now() - lastBumpTime < BUMP_INTERVAL_MS) continue;

        const channel = await client.channels.fetch(guild.channel as string);
        if (!channel?.isSendable()) continue;

        // Keyed on the bump itself, so overlapping ticks (or a second bot instance)
        // cannot remind twice for the same bump, while the next bump still gets its
        // own reminder.
        const claimed = await redis.set(
          `dh_bump_reminder_sent:${guild.guildId}:${lastBumpTime}`,
          '1',
          'EX',
          REMINDER_CLAIM_TTL_SECONDS,
          'NX'
        );
        if (!claimed) continue;

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
          await prisma.dhBumpReminderSettings.delete({
            where: { guildId: guild.guildId },
          });

          await redis.del('dhBumpReminderSettings');

          Logging.warn(
            `Removed DH bump reminder for guild ${guild.guildId} due to unknown channel`
          );
          continue;
        }
        Logging.error(`Error in DH bump reminder tasks: ${error}`);
      }
    }
  } catch (error) {
    Logging.warn(`Error in DH bump reminder tasks: ${error}`);
  }
}

/** Most recent DH bump in the dh_bumps table for this guild, in ms, or null if there is none. */
async function getLastBumpTime(guildId: string): Promise<number | null> {
  const lastDhBump = await prisma.dhBumps.findFirst({
    where: { guildId },
    orderBy: { bumpedAt: 'desc' },
    select: { bumpedAt: true },
  });

  return lastDhBump ? lastDhBump.bumpedAt.getTime() : null;
}

export default {
  name: 'dh-bump-reminder',
  schedule: '* * * * *',

  async execute(client) {
    await bumpReminderTask(client);
  },
} satisfies Task;
