import {
  AttachmentBuilder,
  type ColorResolvable,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { getMinecraftServer } from '../../services/minecraft';

export default {
  data: new SlashCommandBuilder().setName('minecraft').setDescription("See who's online!"),

  async execute(interaction) {
    if (!interaction.guild?.id) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);
    const lang = guildSettings?.language;

    const data = await prisma.minecraftSettings.findFirst({
      where: { guildId: interaction.guild.id },
    });

    if (!data) {
      await interaction.reply({
        content: t(lang, 'minecraft_not_configured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!data.enabled) {
      await interaction.reply({
        content: t(lang, 'minecraft_not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // The status lookup can take up to 5 seconds, longer than the reply window
    await interaction.deferReply();

    const mcData = await getMinecraftServer(data.ip, data.port);

    if (!mcData) {
      await interaction.editReply({ content: t(lang, 'minecraft_offline') });
      return;
    }

    const motdLines = mcData.motd?.split('\n') || [];

    const serverDisplayName = motdLines[0]?.trim() || t(lang, 'minecraft_default_server_name');

    const embed = new EmbedBuilder()
      .setTitle(serverDisplayName)
      .setDescription(motdLines.slice(1).join('\n') || t(lang, 'value_no_description_italic'))
      .setColor((guildSettings?.primaryColor || '#57F287') as ColorResolvable)
      .addFields(
        {
          name: t(lang, 'minecraft_field_status'),
          value: t(lang, 'minecraft_field_status_online'),
          inline: true,
        },
        {
          name: t(lang, 'minecraft_field_player_count'),
          value: `${mcData.online}/${mcData.max}`,
          inline: true,
        },
        {
          name: t(lang, 'minecraft_field_version'),
          value: mcData.version,
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: t(lang, 'minecraft_footer') });

    const files: AttachmentBuilder[] = [];
    // Server icon
    if (mcData.favicon) {
      const base64Data = mcData.favicon.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const attachment = new AttachmentBuilder(buffer, { name: 'favicon.png' });
      embed.setThumbnail('attachment://favicon.png');
      files.push(attachment);
    }

    // Optional player list (only if not too large)
    if (mcData.list.length > 0 && mcData.list.length <= 15) {
      embed.addFields({
        name: t(lang, 'player_list'),
        value: mcData.list.join(', '),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed], files });
  },
} satisfies Command;
