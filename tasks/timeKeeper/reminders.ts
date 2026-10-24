import type { Client } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { t } from '../../lib/i18n';
import { getGuildSettings } from '../../lib/guildSettings';

async function handleReminders(client: Client) {
  const now = new Date();

  const reminders = await prisma.reminder.findMany({
    where: {
      isActive: true,
      remindAt: { lte: now },
    },
  });

  if (reminders.length === 0) return;

  for (const remind of reminders) {
    try {
      const channel = await client.channels.fetch(remind.channelId);

      if (!channel || !channel.isSendable()) continue;

      // v1 looked the settings up by the channel id, so reminders were always
      // sent in the default language
      const guildId = remind.guildId ?? ('guildId' in channel ? channel.guildId : null);
      const guildSettings = guildId ? await getGuildSettings(guildId) : null;

      const content =
        remind.userId === 'server'
          ? `📢 ${t(guildSettings?.language, 'server_reminder')}: ${remind.message}`
          : `<@${remind.userId}> ⏰ ${t(guildSettings?.language, 'reminder')}: ${remind.message}`;

      await channel.send({ content });

      await prisma.reminder.update({
        where: { id: remind.id },
        data: { isActive: false },
      });
    } catch (err) {
      Logging.error(`Failed to send reminder ${remind.id}: ${err}`);
    }
  }
}

/** Sends every reminder that is due. */
export default {
  name: 'reminders',
  schedule: '* * * * *',

  async execute(client) {
    await handleReminders(client);
  },
} satisfies Task;
