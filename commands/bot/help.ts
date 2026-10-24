import { type ColorResolvable, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get the help message and get started message'),

  async execute(interaction) {
    if (!interaction.guild) return;

    const guildSettings = await getGuildSettings(interaction.guildId!);

    const color: ColorResolvable = (guildSettings?.primaryColor as ColorResolvable) ?? '#2F3136';
    const lang = guildSettings.language ?? 'en';

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'bot_help_title'))
      .setColor(color)
      .setDescription(t(lang, 'bot_help_description'))
      .addFields(
        {
          name: t(lang, 'bot_help_field_dashboard_name'),
          value: t(lang, 'bot_help_field_dashboard_value'),
        },
        {
          name: t(lang, 'bot_help_field_modules_name'),
          value: t(lang, 'bot_help_field_modules_value'),
        },
        {
          name: t(lang, 'bot_help_field_commands_name'),
          value: t(lang, 'bot_help_field_commands_value'),
        },
        {
          name: t(lang, 'bot_help_field_support_name'),
          value: t(lang, 'bot_help_field_support_value'),
        },
        {
          name: t(lang, 'bot_help_field_docs_name'),
          value: t(lang, 'bot_help_field_docs_value'),
        }
      )
      .setFooter({ text: t(lang, 'bot_help_footer') });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
} satisfies Command;
