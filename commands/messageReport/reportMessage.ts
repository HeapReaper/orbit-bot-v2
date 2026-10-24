import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
} from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

export default {
  data: new ContextMenuCommandBuilder()
    .setName('Report Message')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    if (!interaction.guild) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);
    const lang = guildSettings?.language;

    const settings = await prisma.messageReportSettings.findUnique({
      where: { guildId: interaction.guild.id },
    });

    if (!settings || !settings.enabled) {
      return interaction.reply({
        content: t(lang, 'messagereport_not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
    }

    const reportedMessage = interaction.targetMessage;

    await prisma.messageReports.create({
      data: {
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        message: reportedMessage.content,
      },
    });

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'messagereport_title'))
      .addFields(
        {
          name: t(lang, 'messagereport_field_reporter'),
          value: `<@${interaction.user.id}>`,
          inline: true,
        },
        {
          name: t(lang, 'messagereport_field_author'),
          value: `<@${reportedMessage.author?.id}>`,
          inline: true,
        },
        {
          name: t(lang, 'messagereport_field_message'),
          value: reportedMessage.content?.slice(0, 1024) || t(lang, 'messagereport_no_content'),
        }
      )
      .setTimestamp()
      .setColor('Red');

    try {
      const channel = await interaction.client.channels.fetch(settings.channel).catch(() => null);
      if (!channel?.isSendable()) return;

      await channel.send({ embeds: [embed] });
    } catch (err) {
      Logging.error(`Message Report: Could not get channel / send message: ${err}`);
    }

    await interaction.reply({
      content: t(lang, 'messagereport_success'),
      flags: MessageFlags.Ephemeral,
    });
  },
} satisfies Command<MessageContextMenuCommandInteraction>;
