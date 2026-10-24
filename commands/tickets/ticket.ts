import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import {
  closeTicket,
  createTicket,
  fetchTicketCategory,
  showEmbedModal,
} from '../../services/tickets';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create tickets')
    .addSubcommand((report) =>
      report
        .setName('admins')
        .setDescription('Open a ticket for the administration')
        .addStringOption((option) =>
          option.setName('reason').setDescription('The reason for the ticket').setRequired(true)
        )
    )
    .addSubcommand((confidential) =>
      confidential
        .setName('confidential')
        .setDescription('Open a ticket that only the owner can see')
        .addStringOption((option) =>
          option.setName('reason').setDescription('The reason for the ticket').setRequired(true)
        )
    )
    .addSubcommand((close) => close.setName('close').setDescription('Close a ticket'))
    .addSubcommand((embed) =>
      embed.setName('embed').setDescription('Send a ticket embed with a button in this channel')
    ),

  async execute(interaction) {
    if (!interaction.guild) return;

    const subCommandName = interaction.options.getSubcommand(false);

    const guildSettings = await getGuildSettings(interaction.guild.id);

    // TODO: Add caching
    const data = await prisma.ticketSettings.findFirst({
      where: { guildId: interaction.guild.id },
    });

    if (!data) {
      await interaction.reply({
        content: t(guildSettings?.language, 'ticket_not_configured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (data.enabled !== 1) {
      await interaction.reply({
        content: t(guildSettings?.language, 'ticket_not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!data.channel || !data.channelConf) {
      await interaction.reply({
        content: t(guildSettings?.language, 'ticket_not_fully_configured'),
        flags: MessageFlags.Ephemeral,
      });
      Logging.error(
        `Ticket channel(s) not configured: channel=${data.channel}, channelConf=${data.channelConf}`
      );
      return;
    }

    switch (subCommandName) {
      case 'admins':
      case 'confidential': {
        const categoryId = subCommandName === 'admins' ? data.channel : data.channelConf;
        const ticketCategory = await fetchTicketCategory(interaction.client, categoryId as string);

        if (!ticketCategory) {
          await interaction.reply({
            content: t(guildSettings?.language, 'ticket_generic_error'),
            flags: MessageFlags.Ephemeral,
          });
          Logging.error(`Could not find ticket category ${categoryId}`);
          return;
        }

        await createTicket(interaction, ticketCategory);
        break;
      }
      case 'close':
        await closeTicket(interaction, data);
        break;
      case 'embed':
        await showEmbedModal(interaction);
        break;
    }
  },
} satisfies Command;
