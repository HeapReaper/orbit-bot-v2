import type { Task, EmbedData } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { sendEmbed } from '../../lib/sendEmbed';
import type { TextChannel } from 'discord.js';

/** Posts the configured message on the guild's creation day, at the configured time. */
export default {
  name: 'server-anniversary',
  schedule: '* * * * *',

  async execute(client) {
    const now = new Date();

    // One query for every configured guild instead of one per guild per minute.
    const allSettings = await prisma.serverAnniversarySettings.findMany({
      where: { enabled: true },
    });

    for (const settings of allSettings) {
      const guild = client.guilds.cache.get(settings.guildId);
      if (!guild) continue;

      const created = guild.createdAt;

      const guildSettings = await getGuildSettings(settings.guildId);
      const timeZone = guildSettings?.timezone || 'Europe/Amsterdam';

      let local: { day: number; month: number; year: number; time: string };
      try {
        const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .format(now)
          .split('-')
          .map(Number) as [number, number, number];

        local = {
          year,
          month,
          day,
          time: new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(now),
        };
      } catch {
        Logging.warn(`ServerAnniversary: unknown timezone "${timeZone}" for ${settings.guildId}`);
        continue;
      }

      const isBirthday =
        created.getUTCDate() === local.day && created.getUTCMonth() + 1 === local.month;

      if (!isBirthday) continue;
      if (settings.time !== local.time) continue;

      const guildAge: number = local.year - created.getUTCFullYear();

      const channel = await client.channels.fetch(settings.channel as string).catch(() => null);

      if (!channel?.isSendable()) continue;

      if (settings.messageType === 'text') {
        if (!settings.message) continue;

        await channel.send(settings.message.replaceAll('{guildAge}', `${guildAge}`));
      } else {
        const embedData = settings.embed as EmbedData;
        const replacements: [string, string][] = [['{guildAge}', `${guildAge}`]];

        await sendEmbed(channel as TextChannel, embedData, replacements);
      }
    }
  },
} satisfies Task;
