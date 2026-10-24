import { type ColorResolvable, EmbedBuilder, type Guild } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getRedisClient } from '../../lib/redis';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

// Helper function to compare two dates (ignoring time)
function sameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/** Reminds guilds whose premium trial is ending and disables expired trials. */
export default {
  name: 'premium-trials',
  // Every day at midnight
  schedule: '0 0 * * *',

  async execute(client) {
    Logging.info('Checking premium guild trials');

    const guilds = await prisma.premiumGuild.findMany({
      where: { trialEndsAt: { not: null } },
    });

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const guild of guilds) {
      if (!guild.trialEndsAt) continue;

      const trialEndsAt = new Date(guild.trialEndsAt);
      const trialDay = new Date(trialEndsAt);
      trialDay.setHours(0, 0, 0, 0);

      const oneDayBefore = new Date(trialDay);
      oneDayBefore.setDate(trialDay.getDate() - 1);

      const sevenDaysBefore = new Date(trialDay);
      sevenDaysBefore.setDate(trialDay.getDate() - 7);

      const reminderKey = `premium_trial_reminder:${guild.guildId}`;

      const guildSettings = await getGuildSettings(guild.guildId);
      const guildLang: string = guildSettings?.language ?? 'en';
      let guildFetched: Guild | null = null;

      try {
        guildFetched = await client.guilds.fetch(guild.guildId);
      } catch (err) {
        Logging.error(`Failed to fetch guild ${guild.guildId}: ${err}`);
        continue;
      }

      // Send trial reminders if settings exist
      if (guildSettings && (sameDay(today, sevenDaysBefore) || sameDay(today, oneDayBefore))) {
        Logging.info(`Sending trial reminder for guild ${guild.guildId}`);

        const embed = new EmbedBuilder()
          .setTitle(t(guildLang, 'trail_will_end_soon'))
          .setColor((guildSettings.primaryColor || '#2F3136') as ColorResolvable)
          .setDescription(t(guildLang, 'trail_end_description'))
          .addFields(
            { name: t(guildLang, 'server'), value: guildFetched.name },
            { name: t(guildLang, 'contact'), value: 'https://discord.gg/HyGNHZCeTQ' },
            { name: t(guildLang, 'email'), value: 'contact@klikbit.nl' }
          );

        try {
          const channel = guildSettings.updatesChannel
            ? await client.channels.fetch(guildSettings.updatesChannel)
            : null;

          if (channel?.isSendable()) {
            await channel.send({ embeds: [embed] });
          } else {
            const owner = await guildFetched.fetchOwner();
            await owner.send({ embeds: [embed] });
          }
        } catch (err) {
          Logging.error(`Failed to send trial end notification for guild ${guild.guildId}: ${err}`);
        }
      }

      // Handle expired trials
      if (trialEndsAt <= now && guild.premium) {
        Logging.info(`Trial expired — disabling premium for guild ${guild.guildId}`);

        try {
          await prisma.premiumGuild.update({
            where: { guildId: guild.guildId },
            data: { premium: false, trialEndsAt: null },
          });

          await prisma.botSettings.update({
            where: { guildId: guild.guildId },
            data: { nickname: 'Orbit' },
          });

          await getRedisClient().del(reminderKey);
        } catch (err) {
          Logging.error(`Failed to disable premium for guild ${guild.guildId}: ${err}`);
        }
      }
    }
  },
} satisfies Task;
