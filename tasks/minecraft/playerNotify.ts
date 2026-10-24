import { type ColorResolvable, EmbedBuilder } from 'discord.js';
import { status } from 'minecraft-server-util';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { getRedisClient } from '../../lib/redis';
import { Logging } from '../../lib/logging';

/**
 * Announces players joining and leaving the configured Minecraft servers.
 *
 * v1 ran this from a 5 second setInterval. Each server lookup can take up to 5
 * seconds itself, so with a few unreachable servers a run outlasted the
 * interval and runs piled up without limit. As a cron task it never overlaps.
 */
export default {
  name: 'minecraft-player-notify',
  schedule: '*/5 * * * * *',

  async execute(client) {
    const redis = getRedisClient();

    let data;
    const cachedData = await redis.get('minecraftSettings');

    if (cachedData) {
      data = JSON.parse(cachedData);
    } else {
      data = await prisma.minecraftSettings.findMany({
        where: {
          enabled: true,
          notifyEnabled: true,
        },
      });

      // Cache it for 5 minutes
      await redis.set('minecraftSettings', JSON.stringify(data), 'EX', 300);
    }

    // Servers are checked in parallel so one slow server does not delay the rest
    await Promise.all(
      data.map(async (server: any) => {
        try {
          const guildSettings = await getGuildSettings(server.guildId);
          const lang = guildSettings?.language;

          const res = await status(server.ip, server.port, { timeout: 5000 });
          const onlinePlayers = res.players.sample?.map((p) => p.name) || [];

          // v1 read `server.guildID` here, which is undefined, so every guild
          // shared one key and saw each other's players join and leave.
          const redisKey = `minecraft:players:${server.guildId}`;
          const cachedPlayersJSON = await redis.get(redisKey);
          const cachedPlayers: string[] = cachedPlayersJSON ? JSON.parse(cachedPlayersJSON) : [];

          const joined = onlinePlayers.filter((p) => !cachedPlayers.includes(p));
          const left = cachedPlayers.filter((p) => !onlinePlayers.includes(p));

          // Save new state
          await redis.set(redisKey, JSON.stringify(onlinePlayers));

          // Skip notifications if nothing changed
          if (joined.length === 0 && left.length === 0) return;

          const channel = await client.channels.fetch(server.channel).catch(() => null);
          if (!channel?.isSendable()) return;

          const joinedText = joined.length > 0 ? `✅ **${joined.join(', ')}**` : '';
          const leftText = left.length > 0 ? `❌ **${left.join(', ')}**` : '';

          const embed = new EmbedBuilder()
            .setTitle(`Minecraft Server - ${t(lang, 'player_update')}`)
            .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable)
            .addFields(
              ...(joined.length > 0
                ? [{ name: t(lang, 'joined'), value: joinedText, inline: false }]
                : []),
              ...(left.length > 0
                ? [{ name: t(lang, 'left'), value: leftText, inline: false }]
                : [])
            )
            .setTimestamp()
            .setFooter({ text: t(lang, 'minecraft_player_activity_footer') });

          await channel
            .send({ embeds: [embed] })
            .then(() => Logging.info(`Sent Minecraft player update for ${server.guildId}`))
            .catch((err) => Logging.error(`Failed to send embed in ${server.channel}: ${err}`));
        } catch {
          // An unreachable server is expected; nothing to report
        }
      })
    );
  },
} satisfies Task;
