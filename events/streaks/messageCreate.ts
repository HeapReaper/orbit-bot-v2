import {
  AttachmentBuilder,
  type ColorResolvable,
  EmbedBuilder,
  Events,
  type Message,
  type PartialMessage,
  type Role,
} from 'discord.js';
import path from 'node:path';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { getRedisClient } from '../../lib/redis';
import { safeRemoveRole } from '../../lib/safeRemoveRole';
import { Logging } from '../../lib/logging';
import { t } from '../../lib/i18n';
import { dayNumber } from '../../lib/dateTime';

async function getStreakSettings(guildId: string) {
  const cacheKey = `streakSettings:${guildId}`;

  const redis = getRedisClient();
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const settings = await prisma.streakSettings.findFirst({
    where: { guildId },
  });

  await redis.set(cacheKey, JSON.stringify(settings), 'EX', 120);

  return settings;
}

async function handleMessage(message: Message | PartialMessage) {
  if (!message.guild) return;
  if (message.author?.bot) return;
  let role: Role | null = null;

  const streakSettings = await getStreakSettings(message.guild.id);

  if (!streakSettings?.enabled) return;

  if (message.partial) message = await message.fetch();

  if (!message.guild) return;

  if (streakSettings.role) {
    role = await message.guild.roles.fetch(streakSettings.role);
  }

  const guildSettings = await getGuildSettings(message.guild.id);
  const now = new Date();

  let userStreak = await prisma.streak.findUnique({
    where: {
      userId_guildId: {
        userId: message.author.id,
        guildId: message.guild.id,
      },
    },
  });

  let sendNotification = false;

  if (!userStreak) {
    userStreak = await prisma.streak.create({
      data: {
        userId: message.author.id,
        guildId: message.guild.id,
        streak: 1,
        lastActive: now,
      },
    });
  } else {
    const lastActive = new Date(userStreak.lastActive);
    const timeZone = guildSettings?.timezone || 'UTC';

    const dayDiff = dayNumber(now, timeZone) - dayNumber(lastActive, timeZone);

    const isSameDay = dayDiff === 0;
    const isNextDay = dayDiff === 1;

    // Nothing changes on a second message the same day; skip the write.
    if (isSameDay) return;

    if (isNextDay) {
      userStreak.streak += 1;
      sendNotification = true;

      if (role) {
        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member) await member.roles.add(role.id).catch(() => null);
      }
    } else {
      // Missed a day: Reset streak
      userStreak.streak = 1;

      if (role) {
        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member) await safeRemoveRole(member, role.id);
      }
    }

    userStreak.lastActive = now;

    // Only reached when the day actually changed — a freshly created row is
    // already correct and no longer gets a redundant second write.
    await prisma.streak.update({
      where: {
        userId_guildId: {
          userId: message.author.id,
          guildId: message.guild.id,
        },
      },
      data: {
        streak: userStreak.streak,
        lastActive: now,
      },
    });
  }

  // Only send notification when streak increases
  if (!sendNotification) return;
  if (!streakSettings.channel) return;

  const channel = await message.client.channels
    .fetch(streakSettings.channel as string)
    .catch(() => null);
  if (!channel?.isSendable()) return;

  const iconPath = path.join(import.meta.dirname, '..', '..', 'media', 'icons', 'streak.png');
  const file = new AttachmentBuilder(iconPath, { name: 'streak.png' });

  const rawColor = guildSettings?.primaryColor;
  const color = rawColor?.startsWith('#') ? rawColor : `#${rawColor ?? '2F3136'}`;

  const embed = new EmbedBuilder()
    .setTitle(t(guildSettings?.language, 'streak_updated_title'))
    .setColor(color as ColorResolvable)
    .setDescription(
      `<@${message.author.id}>\n\n- ${t(guildSettings?.language, 'streak_updated_description', { streak: userStreak.streak.toString() })}`
    )
    .setThumbnail('attachment://streak.png');

  await channel
    .send({ embeds: [embed], files: [file] })
    .catch((error) => Logging.error(`Streaks: could not send notification: ${error}`));
}

/** Extends a member's daily streak on their first message of the day. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    await handleMessage(message);
  },
});
