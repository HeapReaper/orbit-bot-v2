import type { Task } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';

/** Applies the nickname configured on the dashboard. */
export default {
  name: 'bot-nickname',
  schedule: '* * * * *',

  async execute(client) {
    if (process.env.NODE_ENV !== 'production') return;

    const data = await prisma.botSettings.findMany();

    for (const setting of data) {
      const guild = client.guilds.cache.get(setting.guildId as string);
      if (!guild) continue;

      const nickname = setting.nickname as string | null;
      // Skip if nickname is null, undefined, empty string, or "None"
      if (!nickname || nickname.toLowerCase() === 'none') continue;

      const botMember = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      if (!botMember) continue;

      // v1 set the nickname every minute even when it was already correct
      if (botMember.nickname === nickname) continue;

      await botMember
        .setNickname(nickname)
        .then(() => Logging.info(`Nickname changed to: ${nickname} in ${guild.id}`))
        .catch((error) => Logging.warn(`Could not set nickname in ${guild.id}: ${error}`));
    }
  },
} satisfies Task;
