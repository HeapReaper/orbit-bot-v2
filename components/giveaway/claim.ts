import { ActionRowBuilder, ButtonBuilder, MessageFlags } from 'discord.js';
import type { Component } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

/** The 🎁 button a winner presses to claim, id format claim_giveaway_<giveawayId>_<winnerId>. */
export default {
  customId: /^claim_giveaway_/,

  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.guild) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);

    const parts = interaction.customId.split('_');
    const giveawayId = parseInt(parts[2] ?? '', 10);
    const winnerId = parts[3] ?? '';

    if (interaction.user.id !== winnerId) {
      await interaction.reply({
        content: t(guildSettings?.language, 'giveaway_not_winner'),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Disable button
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ButtonBuilder.from(interaction.component).setDisabled(true)
    );

    await interaction.update({
      content: t(guildSettings?.language, 'giveaway_claimed_content', { user: winnerId }),
      components: [disabledRow],
    });

    // Mark winner in DB
    await prisma.giveawayParticipant.update({
      where: { giveawayId_userId: { giveawayId, userId: winnerId } },
      data: { winner: true },
    });

    // Send notification to updates channel
    const giveawaySettings = await prisma.giveawaySettings.findFirst({
      where: {
        guildId: interaction.guild.id,
      },
    });

    if (!giveawaySettings) return;
    if (!giveawaySettings.channel)
      return Logging.error('Could not send giveaway notification because no channel is set');

    const channel = await interaction.client.channels
      .fetch(giveawaySettings.channel)
      .catch(() => null);

    if (!channel?.isSendable())
      return Logging.error(
        'Could not send giveaway notification bacause i could not find a channel'
      );

    await channel.send(
      t(guildSettings?.language, 'giveaway_claimed_channel_notice', { user: winnerId })
    );
  },
} satisfies Component;
