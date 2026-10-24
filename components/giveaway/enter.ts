import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { Component } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

/** The 🎉 button under a giveaway announcement. */
export default {
  customId: 'enter_giveaway',

  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.guild) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);

    const message = interaction.message;
    const embed = message.embeds[0];
    if (!embed) return;

    // Find giveaway by messageId
    const giveaway = await prisma.giveaway.findFirst({
      where: { messageId: message.id, guildId: interaction.guild.id },
    });

    if (!giveaway) return;

    // Check if user already entered
    const participantExists = await prisma.giveawayParticipant.findUnique({
      where: {
        giveawayId_userId: { giveawayId: giveaway.id, userId: interaction.user.id },
      },
    });

    if (participantExists) {
      await interaction.reply({
        content: t(guildSettings?.language, 'giveaway_already_participating'),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Add participant
    await prisma.giveawayParticipant.create({
      data: {
        giveawayId: giveaway.id,
        userId: interaction.user.id,
      },
    });

    // Update embed participation count. The count is read back from the
    // database rather than incremented off the embed text: two people
    // entering at the same time both read the same number there and one of
    // the entries silently vanished from the total.
    const participantCount = await prisma.giveawayParticipant.count({
      where: { giveawayId: giveaway.id },
    });

    const fields = embed.fields.map((f) => ({ ...f }));
    const participantsIndex = fields.findIndex(
      (f) => f.name === t(guildSettings?.language, 'giveaway_field_participants')
    );
    if (participantsIndex !== -1) {
      fields[participantsIndex]!.value = `${participantCount}`;

      const updatedEmbed = EmbedBuilder.from(embed).setFields(fields);
      await message
        .edit({ embeds: [updatedEmbed] })
        .catch((err) => Logging.error(`Giveaway: could not update participant count: ${err}`));
    }

    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_joined'),
      flags: [MessageFlags.Ephemeral],
    });
  },
} satisfies Component;
