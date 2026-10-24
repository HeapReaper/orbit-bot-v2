import type { ApiRoutes } from '../types';
import { prisma } from '../lib/prisma';
import { validateApiRequest } from '../lib/validateApiRequest';

export default ((app, client) => {
  app.get('/api/dh-bumper', async (req, res) => {
    if (!(await validateApiRequest(req, res))) return;

    const guildId = req.headers['x-guild-id'] as string;
    if (!guildId) return res.status(400).json({ error: 'Missing X-Guild-ID header' });

    // Get bumps from the guild from the last 24 hours, group by userId and fetch username with this.client.guilds.members.fetch
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch bumps in the last 24 hours for the guild
    const bumps = await prisma.dhBumps.findMany({
      where: {
        guildId: guildId,
        // Bumps we could not attribute have no user to report here.
        userId: { not: null },
        bumpedAt: {
          gte: twentyFourHoursAgo,
        },
      },
      orderBy: { bumpedAt: 'desc' },
    });

    // Group by userId
    const grouped: Record<string, Date> = {};
    for (const bump of bumps) {
      const userId = bump.userId;
      if (!userId) continue;

      if (!grouped[userId] || bump.bumpedAt > grouped[userId]) {
        grouped[userId] = bump.bumpedAt;
      }
    }

    // Fetch Discord usernames
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const members = await guild.members.fetch({ user: Object.keys(grouped) });

    const result = Object.entries(grouped).map(([userId, lastBumped]) => {
      const member = members.get(userId);
      return {
        id: userId,
        username: member?.user.username ?? 'Unknown',
        lastBumped,
      };
    });

    res.json(result);
  });
}) satisfies ApiRoutes;
