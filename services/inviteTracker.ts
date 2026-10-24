import type { Client, Guild } from 'discord.js';
import { getRedisClient } from '../lib/redis';

/** Snapshot of the use count per invite code, stored per guild in Redis. */
export async function cacheGuildInvites(guild: Guild): Promise<Record<string, number> | null> {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;

  const inviteData: Record<string, number> = {};
  invites.forEach((invite) => {
    inviteData[invite.code] = invite.uses ?? 0;
  });

  await getRedisClient().set(`invites:${guild.id}`, JSON.stringify(inviteData));
  return inviteData;
}

export async function cacheAllInvites(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }
}
