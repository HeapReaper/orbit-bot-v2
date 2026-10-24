import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

/** Checks every message in the counting channel and keeps the count. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    const redis = getRedisClient();

    if (message.author.bot) return;
    if (!message.guild) return;

    const guildId = message.guild.id;
    const settingsCacheKey = `counting_game_settings:${guildId}`;

    let settings: { channel: string; enabled: boolean } | null = null;

    const cached = await redis.get(settingsCacheKey);
    if (cached) {
      settings = JSON.parse(cached);
    } else {
      const dbSettings = await prisma.countingGameSettings.findUnique({
        where: { guildId },
        select: { channel: true, enabled: true },
      });

      if (dbSettings) {
        settings = dbSettings;
        await redis.set(settingsCacheKey, JSON.stringify(settings), 'EX', 60);
      }
    }

    if (!settings || !settings.enabled) return;
    if (message.channel.id !== settings.channel) return;

    const content = message.content.trim();
    const parsed = parseInt(content, 10);
    if (isNaN(parsed) || parsed.toString() !== content) return;

    const game = await prisma.countingGameSettings.findUnique({
      where: { guildId },
      select: { currentCount: true, highScore: true, lastUserId: true },
    });

    if (!game) return;

    const guildSettings = await getGuildSettings(guildId);

    if (game.lastUserId === message.author.id) {
      await message.react('❌').catch(() => null);

      await message.reply(t(guildSettings?.language, 'counting_no_double_count')).catch(() => null);
      return;
    }

    const expected = game.currentCount + 1;

    if (parsed !== expected) {
      await message.react('❌').catch(() => null);

      await message
        .reply(
          t(guildSettings?.language, 'counting_wrong_number', { expected: expected.toString() })
        )
        .catch(() => null);

      await prisma.countingGameSettings.update({
        where: { guildId },
        data: { currentCount: 0, lastUserId: null },
      });

      await prisma.countingUserStats.upsert({
        where: { guildId_userId: { guildId, userId: message.author.id } },
        update: { failCounts: { increment: 1 } },
        create: { guildId, userId: message.author.id, failCounts: 1 },
      });

      Logging.trace(`CountingGame [${guildId}]: wrong number by ${message.author.tag}, reset to 0`);
      return;
    }

    // Conditional update: two people posting the same correct number at the
    // same time both read `currentCount` above, and both used to be accepted.
    // Matching on the count we read means exactly one of them wins the race.
    const accepted = await prisma.countingGameSettings.updateMany({
      where: { guildId, currentCount: game.currentCount },
      data: {
        currentCount: parsed,
        highScore: Math.max(game.highScore, parsed),
        lastUserId: message.author.id,
      },
    });

    if (accepted.count === 0) {
      await message.react('❌').catch(() => null);
      return;
    }

    await prisma.countingUserStats.upsert({
      where: { guildId_userId: { guildId, userId: message.author.id } },
      update: { correctCounts: { increment: 1 } },
      create: { guildId, userId: message.author.id, correctCounts: 1, highestNumber: parsed },
    });

    await prisma.countingUserStats.updateMany({
      where: { guildId, userId: message.author.id, highestNumber: { lt: parsed } },
      data: { highestNumber: parsed },
    });

    await message.react('✅').catch(() => null);
    Logging.trace(
      `CountingGame [${guildId}]: counter updated to ${parsed} by ${message.author.tag}`
    );
  },
});
