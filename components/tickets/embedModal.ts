import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ColorResolvable,
  EmbedBuilder,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import type { Component } from '../../types';
import { GuildLogger } from '../../lib/guildLog';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

/** Submit of the /ticket embed form: posts the embed with the "open ticket" button. */
export default {
  customId: 'ticket_embed_modal',

  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.guild) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);
    const color = (guildSettings?.primaryColor ?? '#5865F2') as ColorResolvable;

    const title = interaction.fields.getTextInputValue('ticket_embed_title');
    const description = interaction.fields.getTextInputValue('ticket_embed_description');
    const buttonText = interaction.fields.getTextInputValue('ticket_embed_button_text');

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);

    const button = new ButtonBuilder()
      .setCustomId('ticket_open')
      .setLabel(buttonText)
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    const channel = interaction.channel as TextChannel;
    await channel.send({ embeds: [embed], components: [row] });

    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_embed_sent'),
      flags: MessageFlags.Ephemeral,
    });

    GuildLogger.info(
      interaction.guild.id,
      `User ${interaction.user.displayName} sent a ticket embed`
    );
  },
} satisfies Component;
