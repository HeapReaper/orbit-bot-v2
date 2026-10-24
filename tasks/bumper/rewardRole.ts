import type { Task } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { safeRemoveRole } from '../../lib/safeRemoveRole';

/**
 * Takes the reward role away from members who have not bumped in 24 hours.
 * Expiring the role does not need minute precision, so this runs hourly.
 */
export default {
  name: 'bump-reminder-reward-role',
  schedule: '0 * * * *',

  async execute(client) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const guildSettings = await prisma.bumpReminderSettings.findMany({
      where: { rewardRole: { not: null } },
    });

    for (const settings of guildSettings) {
      if (!settings.rewardRole) continue;

      const guild = await client.guilds.fetch(settings.guildId).catch(() => null);
      if (!guild) continue;

      const [staleBumpers, recentBumpers] = await Promise.all([
        prisma.bumps.groupBy({
          by: ['userId'],
          where: { guildId: settings.guildId, bumpedAt: { lt: twentyFourHoursAgo } },
        }),
        prisma.bumps.groupBy({
          by: ['userId'],
          where: { guildId: settings.guildId, bumpedAt: { gte: twentyFourHoursAgo } },
        }),
      ]);

      const stillActive = new Set(recentBumpers.map((bump) => bump.userId));

      for (const { userId } of staleBumpers) {
        if (!userId || stillActive.has(userId)) continue;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        await safeRemoveRole(member, settings.rewardRole).catch((error) =>
          Logging.error(`Bumper: could not remove reward role from ${userId}: ${error}`)
        );
      }
    }
  },
} satisfies Task;
