import { EmbedBuilder, Events, type Message, type PartialMessage } from 'discord.js';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { assignLevelRole, getLevelFromXp } from '../../services/leveling';

async function handleNewMessage(message: Message | PartialMessage) {
  const redis = getRedisClient();

  try {
    if (!message.author) return;
    if (message.author.bot) return;
    if (!message.guild) return;

    const levelingSettings = await prisma.levelingSettings.findFirst({
      where: { guildId: message.guild.id },
    });

    if (!levelingSettings || !levelingSettings.enabled) return;

    const cooldownKey = `leveling:msg:${message.guild.id}:${message.author.id}`;
    const canGain = await redis.get(cooldownKey);
    if (canGain) return;

    const xpToAdd = levelingSettings.xpPerMessage ?? 10;

    let userData = await prisma.leveling.findFirst({
      where: { guildId: message.guild.id, userId: message.author.id },
    });

    if (userData) {
      userData = await prisma.leveling.update({
        where: { guildId_userId: { guildId: message.guild.id, userId: message.author.id } },
        data: { xp: { increment: xpToAdd } },
      });
    } else {
      userData = await prisma.leveling.create({
        data: { guildId: message.guild.id, userId: message.author.id, xp: xpToAdd, level: 0 },
      });
    }

    const oldLevel = userData.level;

    const newLevel = getLevelFromXp(
      userData.xp,
      levelingSettings.xpRate,
      levelingSettings.curveExponent
    );

    // FIXED?: loop through all intermediate levels
    if (newLevel > oldLevel) {
      for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
        await assignLevelRole(
          message.client,
          message.guild.id,
          message.author.id,
          lvl,
          levelingSettings
        );
      }

      await prisma.leveling.update({
        where: {
          guildId_userId: {
            guildId: message.guild.id,
            userId: message.author.id,
          },
        },
        data: { level: newLevel },
      });

      const channel = levelingSettings.channel
        ? await message.guild.channels.fetch(levelingSettings.channel).catch(() => null)
        : null;

      if (channel?.isTextBased()) {
        const guildSettings = await getGuildSettings(message.guild.id);

        const embed = new EmbedBuilder()
          .setColor(0x00ff99) // TODO: Use guild color from guildSettings
          .setTitle(t(guildSettings?.language, 'leveling_level_up_title'))
          .setDescription(
            t(guildSettings?.language, 'leveling_level_up_description', {
              user: message.author.id,
              level: newLevel.toString(),
            })
          )
          .addFields(
            {
              name: t(guildSettings?.language, 'leveling_field_previous_level'),
              value: `${oldLevel}`,
              inline: true,
            },
            {
              name: t(guildSettings?.language, 'leveling_field_new_level'),
              value: `${newLevel}`,
              inline: true,
            }
          )
          .setTimestamp();

        await channel.send({ embeds: [embed] }).catch((error) => {
          Logging.error(`Could not send level-up message: ${error}`);
        });
      }

      Logging.info(
        `[Level Up] ${message.author.tag} leveled up to Level ${newLevel} in guild ${message.guild.name}`
      );
    }

    let cooldown = 60;
    switch (levelingSettings.xpMessageGainSpeed) {
      case 'everyMessage':
        cooldown = 0;
        break;
      case 'oneTimeAMinute':
        cooldown = 60;
        break;
      case 'oneTimeEvery2Minutes':
        cooldown = 120;
        break;
      case 'oneTimeEvery3Minutes':
        cooldown = 180;
        break;
      case 'oneTimeEvery4Minutes':
        cooldown = 240;
        break;
      case 'oneTimeEvery5Minutes':
        cooldown = 300;
        break;
    }

    if (cooldown > 0) await redis.set(cooldownKey, '1', 'EX', cooldown);
  } catch (error) {
    Logging.error(`Error in [handleNewMessage]: ${error}`);
  }
}

/** Grants message XP, levels members up and hands out level roles. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author?.bot) return;
    await handleNewMessage(message);
  },
});
