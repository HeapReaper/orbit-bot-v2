import { type Client, type ColorResolvable, EmbedBuilder } from 'discord.js';
import type { EmbedData, Task } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';

const BIWEEKLY_MS = 14 * 24 * 60 * 60 * 1000;

async function task(client: Client) {
  Logging.trace('Running auto message task');

  const messages = await prisma.autoMessage.findMany({
    where: {
      enabled: true,
    },
  });

  const now = new Date();

  // Every guild is evaluated in its own timezone. Hardcoding Europe/Amsterdam
  // meant a schedule set to 09:00 fired at 09:00 CET wherever the server was.
  const timeZones = new Map<string, string>();

  const localNow = (timeZone: string) => {
    try {
      return {
        time: new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone,
        }).format(now),
        dayShort: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone })
          .format(now)
          .replace('.', ''),
        date: Number(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone }).format(now)),
      };
    } catch {
      Logging.warn(`AutoMessage: unknown timezone "${timeZone}", falling back to UTC`);
      return localNow('UTC');
    }
  };

  for (const message of messages) {
    if (!timeZones.has(message.guildId)) {
      const guildSettings = await getGuildSettings(message.guildId);
      timeZones.set(message.guildId, guildSettings?.timezone || 'Europe/Amsterdam');
    }

    const {
      time: currentTime,
      dayShort: currentDayShort,
      date: currentDate,
    } = localNow(timeZones.get(message.guildId)!);

    // Time must match exactly
    if (message.time !== currentTime) continue;

    // Prevent double send in same minute
    if (message.lastSentAt) {
      const diff = now.getTime() - message.lastSentAt.getTime();
      if (diff < 60 * 1000) continue;
    }

    const days: string[] = Array.isArray(message.days) ? (message.days as string[]) : [];

    // === SCHEDULE HANDLING ===
    switch (message.scheduleType) {
      case 'daily':
        break;

      case 'weekly':
        if (days.length > 0 && !days.includes(currentDayShort)) {
          continue;
        }
        break;

      case 'biweekly':
        if (days.length > 0 && !days.includes(currentDayShort)) {
          continue;
        }

        if (message.lastSentAt) {
          const diff = now.getTime() - message.lastSentAt.getTime();
          if (diff < BIWEEKLY_MS) {
            continue;
          }
        }
        break;

      case 'monthly':
        if (!message.monthlyDate || message.monthlyDate !== currentDate) {
          continue;
        }

        // Prevent multiple sends in same month
        if (
          message.lastSentAt &&
          message.lastSentAt.getMonth() === now.getMonth() &&
          message.lastSentAt.getFullYear() === now.getFullYear()
        ) {
          continue;
        }
        break;

      default:
        Logging.error(`Unknown scheduleType for message ID ${message.id}`);
        continue;
    }

    // === FETCH CHANNEL ===
    const channel = await client.channels.fetch(message.channel).catch(() => null);

    if (!channel?.isSendable()) continue;

    try {
      // === SEND MESSAGE ===
      if (message.messageType === 'text') {
        const content = message.message.replace(/<u>(.*?)<\/u>/gi, '__$1__');
        await channel.send({ content });
      } else if (message.messageType === 'embed' && message.embed) {
        const embedData = message.embed as EmbedData;
        const e = new EmbedBuilder();

        if (embedData.color) e.setColor((embedData.color as ColorResolvable) ?? '#2F3136');
        if (embedData.title) e.setTitle(embedData.title);
        if (embedData.titleUrl) e.setURL(embedData.titleUrl);
        if (embedData.description) e.setDescription(embedData.description);

        if (embedData.author?.name) {
          e.setAuthor({
            name: embedData.author.name,
            iconURL: embedData.author.icon || undefined,
          });
        }

        if (embedData.thumbnail) e.setThumbnail(embedData.thumbnail);
        if (embedData.image) e.setImage(embedData.image);

        if (embedData.fields?.length) {
          e.addFields(
            embedData.fields
              .filter((f) => f.name && f.value)
              .map((f) => ({
                name: f.name,
                value: f.value,
                inline: f.inline ?? false,
              }))
          );
        }

        await channel.send({ embeds: [e] });
      }

      // === UPDATE lastSentAt ===
      await prisma.autoMessage.update({
        where: { id: message.id },
        data: { lastSentAt: now },
      });

      Logging.info(
        `Sent auto message ${message.id} to ${channel.id} (${currentDayShort} ${currentTime})`
      );
    } catch (err) {
      Logging.error(`Failed to send message ${message.id} to ${channel?.id}: ${err}`);
    }
  }
}

/** Sends the scheduled messages configured on the dashboard. */
export default {
  name: 'auto-message',
  schedule: '* * * * *',

  async execute(client) {
    await task(client);
  },
} satisfies Task;
