import type { Message, PartialMessage } from 'discord.js';
import { Logging } from '../lib/logging';
import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/redis';
import {
  extractBumperId,
  isDhBumpConfirmation,
  isDhBumpMessage,
  messageText,
} from './dhBumpDetect';

const BUMP_INTERVAL_SECONDS = 2 * 60 * 60;

export async function handleDhBumpMessage(message: Message | PartialMessage) {
  const redis = getRedisClient();

  if (!message.guild) return;

  // A partial carries no author, so it has to be fetched before it can be
  // recognised, but only for messages that could plausibly be DH's. v1
  // fetched every edited uncached message in every guild.
  if (!message.partial && !isDhBumpMessage(message)) return;
  if (message.partial && message.author && !isDhBumpMessage(message)) return;

  let resolved = message;

  if (resolved.partial) {
    const fetched = await resolved.fetch().catch(() => null);
    if (!fetched) return;
    resolved = fetched;
  }

  if (!isDhBumpMessage(resolved)) return;
  if (!resolved.guild) return;

  if (!isDhBumpConfirmation(resolved)) {
    Logging.debug(
      `DhBumper: message ${resolved.id} from DH bot did not match a bump confirmation: ${messageText(resolved).replace(/\s+/g, ' ').slice(0, 300)}`
    );
    return;
  }

  const guildId = resolved.guild.id;

  // One bump per message: create and update both fire for the same confirmation,
  // and DH may edit it again to refresh its cooldown line.
  const claimed = await redis.set(
    `dh_bump_recorded:${resolved.id}`,
    '1',
    'EX',
    BUMP_INTERVAL_SECONDS,
    'NX'
  );
  if (!claimed) return;

  const userId = extractBumperId(resolved);

  // Add to bump log — this row is what the reminder task times off, so it is written
  // first, without a user if need be, and before anything that may bail out (XP,
  // reward role). An unattributed bump keeps the reminder ticking; it is only left
  // out of the leaderboards.
  try {
    await prisma.dhBumps.create({
      data: {
        guildId: guildId,
        userId: userId,
      },
    });
  } catch (err) {
    Logging.error(`Could not add DH bump event to bumps table: ${err}`);
  }

  if (!userId) {
    Logging.error(
      `DhBumper: bump confirmation ${resolved.id} in guild ${guildId} has no resolvable bumper, reminder scheduled but bump not attributed.`
    );
    return;
  }

  const user = await resolved.guild.members.fetch(userId).catch(() => null);

  Logging.trace(`${user?.user.tag ?? userId} successfully bumped the server on discordhome.com!`);

  const settings = await prisma.dhBumpReminderSettings.findFirst({
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
      Logging.error(`DhBumper: Could not increment leveling XP: ${err}`);
    }
  }

  if (settings.rewardRole) {
    const member = user ?? (await resolved.guild.members.fetch(userId).catch(() => null));

    if (!member) return;
    if (member.roles.cache.has(settings.rewardRole)) return;

    await member.roles
      .add(settings.rewardRole)
      .catch((err) => Logging.error(`DhBumper: could not add reward role: ${err}`));
  }
}
