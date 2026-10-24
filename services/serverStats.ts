import type { Guild } from 'discord.js';

export interface GuildCounts {
  memberCount: number;
  botCount: number;
  /** Non-bot members whose status is "online". */
  onlineCount: number;
  channelCount: number;
  rolesCount: number;
  boostCount: number;
}

/**
 * Fetches every member with their presence and counts from the returned
 * collection. v1 counted from `guild.members.cache`, which only worked because
 * that cache was never trimmed; it is capped now to keep memory down.
 */
export async function collectCounts(guild: Guild): Promise<GuildCounts> {
  const members = await guild.members.fetch({ withPresences: true });

  return {
    memberCount: guild.memberCount,
    botCount: members.filter((m) => m.user.bot).size,
    onlineCount: members.filter((m) => !m.user.bot && m.presence?.status === 'online').size,
    channelCount: guild.channels.cache.size,
    rolesCount: guild.roles.cache.size,
    boostCount: guild.premiumSubscriptionCount ?? 0,
  };
}
