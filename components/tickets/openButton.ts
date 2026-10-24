import { MessageFlags } from 'discord.js';
import type { Component } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { createTicket, fetchTicketCategory } from '../../services/tickets';

/** The "open ticket" button under a ticket embed. */
export default {
  customId: 'ticket_open',

  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.guild) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);

    const data = await prisma.ticketSettings.findFirst({
      where: { guildId: interaction.guild.id },
    });

    if (!data || data.enabled !== 1) {
      await interaction.reply({
        content: t(guildSettings?.language, 'ticket_not_enabled_server'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!data.channel) {
      await interaction.reply({
        content: t(guildSettings?.language, 'ticket_channel_not_configured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticketCategory = await fetchTicketCategory(interaction.client, data.channel);

    if (!ticketCategory) {
      await interaction.reply({
        content: t(guildSettings?.language, 'ticket_generic_error'),
        flags: MessageFlags.Ephemeral,
      });
      Logging.error(`Could not find ticket category for button`);
      return;
    }

    await createTicket(interaction, ticketCategory);
  },
} satisfies Component;
