import { ChannelType } from 'discord.js';
import type { ApiRoutes } from '../types';

export default ((app, client) => {
  app.get('/api/expose-guild-channels-and-roles', (_req, res) => {
    if (!client.isReady()) {
      return res.status(503).json({ error: 'Bot not ready' });
    }

    const guildsData = client.guilds.cache.map((guild) => ({
      id: guild.id.toString(),
      name: guild.name,
      channels: guild.channels.cache.map((channel) => ({
        id: channel.id.toString(),
        name: channel.name,
        type: channel.type,
      })),
      roles: guild.roles.cache.map((role) => ({
        id: role.id.toString(),
        name: role.name,
        color: role.color,
        position: role.position,
        hoist: role.hoist,
        permissions: role.permissions.bitfield.toString(),
        managed: role.managed,
      })),
    }));

    const totalGuilds = client.guilds.cache.size;

    // v1 counted the unique members in the member cache, which is now capped
    // to keep memory down; the sum of the member counts does not depend on it.
    const totalUsers = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0);

    res.json({
      guilds: guildsData,
      totalGuilds,
      totalUsers,
    });
  });

  app.get('/api/expose-guild-categories', (_req, res) => {
    if (!client.isReady()) {
      return res.status(503).json({ error: 'Bot not ready' });
    }

    const guildsData = client.guilds.cache.map((guild) => ({
      id: guild.id.toString(),
      name: guild.name,
      categories: guild.channels.cache
        .filter((channel) => channel.type === ChannelType.GuildCategory)
        .map((category) => ({
          id: category.id.toString(),
          name: category.name,
          position: category.position,
        })),
    }));

    res.json({ guilds: guildsData });
  });
}) satisfies ApiRoutes;
