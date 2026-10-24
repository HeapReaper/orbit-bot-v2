import { type Client, EmbedBuilder } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { getLevelFromXp } from '../../services/leveling';

async function voiceXpTick(client: Client) {
  const redis = getRedisClient();

  try {
    const allSettings = await prisma.levelingSettings.findMany({
      where: { enabled: true },
    });

    const voiceSpeedToSeconds: Record<string, number> = {
      everyMinute: 60,
      every2Minutes: 120,
      every3Minutes: 180,
      every4Minutes: 240,
      every5Minutes: 300,
    };

    for (const settings of allSettings) {
      const guild = client.guilds.cache.get(settings.guildId);
      if (!guild) continue;

      const intervalSeconds = voiceSpeedToSeconds[settings.xpVoiceGainSpeed] ?? 60;
      const xpToAdd = settings.xpPerVoice ?? 5;

      for (const [, channel] of guild.channels.cache) {
        if (!channel.isVoiceBased()) continue;

        const humanMembers = channel.members.filter((m) => !m.user.bot);
        if (humanMembers.size < 2) continue;

        for (const [, member] of humanMembers) {
          const cooldownKey = `leveling:voicetask:${settings.guildId}:${member.id}`;
          if (await redis.get(cooldownKey)) continue;

          let userData = await prisma.leveling.findFirst({
            where: { guildId: settings.guildId, userId: member.id },
          });

          if (userData) {
            userData = await prisma.leveling.update({
              where: { guildId_userId: { guildId: settings.guildId, userId: member.id } },
              data: { xp: { increment: xpToAdd } },
            });
          } else {
            userData = await prisma.leveling.create({
              data: { guildId: settings.guildId, userId: member.id, xp: xpToAdd, level: 0 },
            });
          }

          await redis.set(cooldownKey, '1', 'EX', intervalSeconds);

          const oldLevel = userData.level;
          const newLevel = getLevelFromXp(userData.xp, settings.xpRate, settings.curveExponent);

          if (newLevel <= oldLevel) continue;

          await prisma.leveling.update({
            where: { guildId_userId: { guildId: settings.guildId, userId: member.id } },
            data: { level: newLevel },
          });

          const levelChannel = settings.channel
            ? await guild.channels.fetch(settings.channel).catch(() => null)
            : null;

          if (levelChannel?.isTextBased()) {
            const guildSettings = await getGuildSettings(settings.guildId);
            const rawColor = guildSettings?.primaryColor;
            const color = rawColor?.startsWith('#') ? rawColor : `#${rawColor ?? '2F3136'}`;

            const embed = new EmbedBuilder()
              .setColor(color as `#${string}`)
              .setTitle(t(guildSettings?.language, 'leveling_level_up_title'))
              .setDescription(
                t(guildSettings?.language, 'leveling_level_up_description', {
                  user: member.id,
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

            await levelChannel.send({ embeds: [embed] }).catch((error) => {
              Logging.error(`Could not send voice level-up message: ${error}`);
            });
          }

          Logging.info(
            `[Voice Level Up] ${member.user.tag} leveled up to Level ${newLevel} in guild ${guild.name}`
          );
        }
      }
    }
  } catch (error) {
    Logging.error(`Error in [voiceXpTick]: ${error}`);
  }
}

/** Grants voice XP to members talking with at least one other person. */
export default {
  name: 'leveling-voice-xp',
  schedule: '* * * * *',

  async execute(client) {
    await voiceXpTick(client);
  },
} satisfies Task;
