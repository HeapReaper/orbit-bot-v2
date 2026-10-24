import type { Message, PartialMessage } from 'discord.js';
import { Logging } from '../lib/logging';
import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/redis';
import {
  extractBumperId,
  isBumpConfirmation,
  isDisboardMessage,
  messageText,
} from './disboardDetect';

const BUMP_INTERVAL_SECONDS = 2 * 60 * 60;

export async function handleBumpMessage(message: Message | PartialMessage) {
  const redis = getRedisClient();

  if (!message.guild) return;

  // A partial carries no author, so it has to be fetched before it can be
  // recognised — but only bother for messages that could plausibly be
  // Disboard's. Fetching every edited message in every guild was a needless
  // API call per edit across the whole bot.
  if (!message.partial && !isDisboardMessage(message)) return;
  if (message.partial && message.author && !isDisboardMessage(message)) return;

  let resolved = message;

  if (resolved.partial) {
    const fetched = await resolved.fetch().catch(() => null);
    if (!fetched) return;
    resolved = fetched;
  }

  if (!isDisboardMessage(resolved)) return;
  if (!resolved.guild) return;

  if (!isBumpConfirmation(resolved)) {
    Logging.debug(
      `Bumper: message ${resolved.id} from Disboard did not match a bump confirmation: ${messageText(
        resolved
      )
        .replace(/\s+/g, ' ')
        .slice(0, 300)}`
    );
    return;
  }

  const guildId = resolved.guild.id;

  // One bump per message: create and update both fire for the same confirmation, and
  // Disboard may edit it again afterwards — without this the bump (and the XP) would
  // be counted twice.
  const claimed = await redis.set(
    `bump_recorded:${resolved.id}`,
    '1',
    'EX',
    BUMP_INTERVAL_SECONDS,
    'NX'
  );
  if (!claimed) return;

  const userId = extractBumperId(resolved);

  if (!userId) {
    Logging.error(
      `Bumper: bump confirmation ${resolved.id} in guild ${guildId} has no resolvable bumper, reminder rescheduled but bump not attributed.`
    );
    return;
  }

  const user = await resolved.guild.members.fetch(userId).catch(() => null);

  Logging.trace(`${user?.user.tag ?? userId} successfully bumped the server!`);

  // Add to bump log — this row is also what the reminder task times off, so it is
  // written before anything that may bail out (XP, reward role).
  try {
    await prisma.bumps.create({
      data: {
        guildId: guildId,
        userId: userId,
      },
    });
  } catch (err) {
    Logging.error(`Could not add bump event to bumps table: ${err}`);
  }

  const settings = await prisma.bumpReminderSettings.findFirst({
    where: {
      guildId: guildId,
    },
  });

  if (!settings || !settings.enabled) return;

  if (settings.xpBoost !== 0) {
    try {
      await prisma.leveling.upsert({
        where: {
          guildId_userId: {
            guildId: guildId,
            userId: userId,
          },
        },
        update: {
          xp: {
            increment: settings.xpBoost,
          },
        },
        create: {
          guildId: guildId,
          userId: userId,
          xp: settings.xpBoost,
          level: 0,
        },
      });
    } catch (err) {
      Logging.error(`Bumper: Could not increment leveling XP: ${err}`);
    }
  }

  if (settings.rewardRole) {
    const member = user ?? (await resolved.guild.members.fetch(userId).catch(() => null));

    if (!member) return;
    if (member.roles.cache.has(settings.rewardRole)) return;

    await member.roles
      .add(settings.rewardRole)
      .catch((err) => Logging.error(`Bumper: could not add reward role: ${err}`));
  }
}
