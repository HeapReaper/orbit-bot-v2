import type { ApiRoutes } from '../types';
import { validateApiRequest } from '../lib/validateApiRequest';
import { getRedisClient } from '../lib/redis';

export default ((app, client) => {
  app.get('/api/ServerStats', async (req, res) => {
    if (!(await validateApiRequest(req, res))) return;

    const guildId = req.headers['x-guild-id'] as string;
    if (!guildId) return res.status(400).json({ error: 'Missing X-Guild-ID header' });

    // Check cache
    const cacheKey = `server_stats_api:${guildId}`;
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    // withPresences: presences are no longer kept in memory between requests
    const members = await guild.members.fetch({ withPresences: true });

    const totalMembers = guild.memberCount;
    const onlineMembers = members.filter((m) => m.presence?.status === 'online').size;
    const idleMembers = members.filter((m) => m.presence?.status === 'idle').size;
    const dndMembers = members.filter((m) => m.presence?.status === 'dnd').size;
    const offlineMembers = members.filter(
      (m) => !m.presence || m.presence.status === 'offline'
    ).size;
    const botCount = members.filter((m) => m.user.bot).size;
    const humanCount = totalMembers - botCount;

    const lastJoined = members
      .filter((m) => m.joinedAt !== null)
      .sort((a, b) => b.joinedAt!.getTime() - a.joinedAt!.getTime())
      .first();

    const channels = await guild.channels.fetch();
    const textChannels = channels.filter((c) => c?.isTextBased() && !c.isThread()).size;
    const voiceChannels = channels.filter((c) => c?.isVoiceBased()).size;
    const categoryCount = channels.filter((c) => c?.type === 4).size;

    const roles = await guild.roles.fetch();

    const result = {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ size: 256 }),
      description: guild.description,
      ownerId: guild.ownerId,
      createdAt: guild.createdAt,
      members: {
        total: totalMembers,
        humans: humanCount,
        bots: botCount,
        online: onlineMembers,
        idle: idleMembers,
        dnd: dndMembers,
        offline: offlineMembers,
        lastJoinedAt: lastJoined?.joinedAt ?? null,
      },
      boosts: {
        level: guild.premiumTier,
        count: guild.premiumSubscriptionCount ?? 0,
      },
      channels: {
        total: channels.size,
        text: textChannels,
        voice: voiceChannels,
        categories: categoryCount,
      },
      roles: roles.size,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
    };

    // Cache 320 seconds
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 320);

    res.json(result);
  });
}) satisfies ApiRoutes;
