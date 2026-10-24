import { PermissionsBitField } from 'discord.js';
import type { ApiRoutes } from '../types';
import { registerCommands } from '../lib/registerCommands';
import { getEnv } from '../lib/env';
import { Logging } from '../lib/logging';

export default ((app, client) => {
  app.get('/api/bot-info', (_req, res) => {
    if (!client.isReady()) {
      return res.status(503).json({ error: 'Bot not ready' });
    }

    const uptimeSeconds = process.uptime();
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    res.json({
      status: 'Online',
      uptime: `${hours}h ${minutes}m`,
      ping: client.ws.ping,
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
      channels: client.channels.cache.size,
      nodeVersion: process.version,
      memoryUsageMB: (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2),
      platform: process.platform,
    });
  });

  app.post('/api/refresh-commands', async (req, res) => {
    if (!req.headers['x-api-key'] || req.headers['x-api-key'] !== getEnv('API_KEY'))
      return res.status(401).json({ error: 'Unauthorized' });

    try {
      const guildId = req.query.guildId as string | undefined;
      Logging.info(`[refresh-commands] Received request${guildId ? ` for guild ${guildId}` : ''}`);

      await registerCommands(guildId);

      res.json({
        success: true,
        message: guildId
          ? `Slash commands refreshed for guild ${guildId}`
          : 'Slash commands refreshed globally',
      });
    } catch (error) {
      Logging.error(`[refresh-commands] ${error}`);
      res.status(500).json({
        success: false,
        error: 'Failed to refresh slash commands',
        details: error instanceof Error ? error.message : error,
      });
    }
  });

  app.get('/api/fetch-info', async (req, res) => {
    Logging.debug('API call /api/fetch-info');

    try {
      const type = req.query.type as 'user' | 'channel';
      const idsParam = req.query.ids as string;
      if (!type || !idsParam) {
        return res.status(400).json({ error: 'Missing required query params: type, ids' });
      }

      const ids = idsParam.split(',').map((id) => id.trim());

      if (!client.isReady()) {
        return res.status(503).json({ error: 'Bot not ready' });
      }

      const results: Record<string, string> = {};

      if (type === 'user') {
        for (const id of ids) {
          try {
            const user =
              client.users.cache.get(id) || (await client.users.fetch(id).catch(() => null));
            if (user) results[id] = user.tag || user.username;
          } catch {
            results[id] = 'Unknown User';
          }
        }
      } else if (type === 'channel') {
        for (const id of ids) {
          try {
            const channel =
              client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
            if (channel && 'name' in channel && channel.name) results[id] = channel.name;
          } catch {
            results[id] = 'Unknown Channel';
          }
        }
      } else {
        return res.status(400).json({ error: "Invalid type. Must be 'user' or 'channel'." });
      }

      res.json({ type, results });
    } catch (error) {
      Logging.error(`[fetch-info] ${error}`);
      res.status(500).json({
        error: 'Failed to fetch info',
        details: error instanceof Error ? error.message : error,
      });
    }
  });

  app.get('/api/guilds', async (req, res) => {
    Logging.debug('API call /api/guilds');

    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const userId = req.query.userId as string;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      const results: { id: string; name: string; icon: string | null; ownerId: string }[] = [];

      // The guild cache is always complete with the Guilds intent, so there is
      // no need for v1's extra API round trip per guild.
      for (const guild of client.guilds.cache.values()) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;

          if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) continue;

          results.push({
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            ownerId: guild.ownerId,
          });
        } catch (err) {
          Logging.warn(`Skipping guild ${guild.id}: ${err}`);
        }
      }

      return res.json({ guilds: results });
    } catch (error) {
      Logging.error(`[/api/guilds] ${error}`);
      return res.status(500).json({
        error: 'Failed to fetch guilds',
        details: error instanceof Error ? error.message : error,
      });
    }
  });
}) satisfies ApiRoutes;
