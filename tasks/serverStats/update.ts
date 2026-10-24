import type { Guild, VoiceChannel } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { collectCounts } from '../../services/serverStats';

async function rename(channelId: string | null, guild: Guild, name: string) {
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId) as VoiceChannel | undefined;
  if (!channel) return;

  // Avoid unnecessary API calls
  if (channel.name === name) return;

  try {
    await channel.setName(name);
  } catch {
    Logging.warn(`Failed to rename channel ${channelId} in ${guild.id}`);
  }
}

async function updateGuildStats(guild: Guild, stats: any) {
  try {
    const counts = await collectCounts(guild);

    await rename(stats.memberCountChannelId, guild, `👥 Members: ${counts.memberCount}`);
    await rename(stats.boostCountChannelId, guild, `🚀 Boosts: ${counts.boostCount}`);
    await rename(stats.botCountChannelId, guild, `🤖 Bots: ${counts.botCount}`);
    await rename(stats.onlineMemberCountChannelId, guild, `🟢 Online: ${counts.onlineCount}`);
    await rename(stats.channelCountChannelId, guild, `📁 Channels: ${counts.channelCount}`);
    await rename(stats.rolesCountChannelId, guild, `🎭 Roles: ${counts.rolesCount}`);
  } catch (error) {
    Logging.error(`Failed updating stats for guild ${guild.id}: ${error}`);
  }
}

/** Keeps the stat counter channels up to date. */
export default {
  name: 'server-stats',
  schedule: '*/5 * * * *',

  async execute(client) {
    const rows = await prisma.serverStats.findMany();

    for (const stats of rows) {
      const guild = client.guilds.cache.get(stats.guildId);
      if (!guild) continue;

      await updateGuildStats(guild, stats);
    }
  },
} satisfies Task;
