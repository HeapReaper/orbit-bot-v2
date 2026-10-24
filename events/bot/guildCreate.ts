import { EmbedBuilder, Events } from 'discord.js';
import { defineEvent } from '../../types';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { Logging } from '../../lib/logging';

/** DMs the owner of a newly joined guild a getting-started message. */
export default defineEvent({
  name: Events.GuildCreate,
  async execute(guild) {
    try {
      const owner = await guild.fetchOwner();
      if (!owner) return;

      const guildSettings = await getGuildSettings(guild.id);
      const lang = guildSettings?.language;

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'bot_welcome_title'))
        .setColor('DarkBlue')
        .setDescription(t(lang, 'bot_help_description'))
        .addFields(
          {
            name: t(lang, 'bot_welcome_field_dashboard_setup_name'),
            value: t(lang, 'bot_welcome_field_dashboard_setup_value'),
          },
          {
            name: t(lang, 'bot_welcome_field_configure_modules_name'),
            value: t(lang, 'bot_welcome_field_configure_modules_value'),
          },
          {
            name: t(lang, 'bot_help_field_commands_name'),
            value: t(lang, 'bot_welcome_field_commands_value'),
          },
          {
            name: t(lang, 'bot_help_field_support_name'),
            value: t(lang, 'bot_welcome_field_support_value'),
          },
          {
            name: t(lang, 'bot_welcome_field_get_started_name'),
            value: t(lang, 'bot_welcome_field_get_started_value'),
          }
        )
        .setFooter({ text: t(lang, 'bot_welcome_footer') });

      await owner.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      Logging.error(`Failed to send DM to server owner: ${err}`);
    }
  },
});
