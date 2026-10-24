import type { Client } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { safeRemoveRole } from '../../lib/safeRemoveRole';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { dayNumber } from '../../lib/dateTime';

async function handleTask(client: Client) {
  Logging.trace('[StreakTask] Running streak expiration task');

  const streakSettings = await prisma.streakSettings.findMany({
    where: { enabled: true, role: { not: null } },
  });

  const now = new Date();

  for (const setting of streakSettings) {
    if (!setting.guildId || !setting.role) continue;

    const guild = await client.guilds.fetch(setting.guildId).catch(() => null);
    if (!guild) continue;

    const guildSettings = await getGuildSettings(setting.guildId);
    const timeZone = guildSettings?.timezone || 'UTC';
    const today = dayNumber(now, timeZone);

    // A streak survives as long as the user still posts on the day after their
    // last message. Expiring on a rolling 24 hours instead used to kill a
    // streak that was still alive — someone active at 02:00 yesterday lost it
    // at 02:00 today, before the day they were still allowed to post had ended.
    const candidates = await prisma.streak.findMany({
      where: {
        guildId: setting.guildId,
        streak: { not: 0 },
        lastActive: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });

    for (const streak of candidates) {
      const missedDays = today - dayNumber(new Date(streak.lastActive), timeZone);
      if (missedDays < 2) continue;

      const member = await guild.members.fetch(streak.userId).catch(() => null);
      if (member) await safeRemoveRole(member, setting.role);

      // Reset streak days to 0
      await prisma.streak.update({
        where: {
          userId_guildId: {
            userId: streak.userId,
            guildId: guild.id,
          },
        },
        data: {
          streak: 0,
        },
      });
    }
  }
}

/** Resets streaks of members who skipped a day and takes away the streak role. */
export default {
  name: 'streaks-expire',
  schedule: '* * * * *',

  async execute(client) {
    await handleTask(client);
  },
} satisfies Task;
