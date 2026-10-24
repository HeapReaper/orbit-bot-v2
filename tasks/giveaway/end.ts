import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  type TextChannel,
} from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getRandomElement } from '../../lib/random';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

async function endGiveaways(client: Client): Promise<void> {
  const now = new Date();

  // Find all active giveaways that have ended
  const giveaways = await prisma.giveaway.findMany({
    where: {
      active: true,
      endsAt: { lte: now },
    },
    include: { giveaway_participants: true },
  });

  for (const giveaway of giveaways) {
    if (!giveaway.messageId) continue;
    Logging.info(`Giveaway with the prize: "${giveaway.prize}" has ended!`);

    // Fetch the guild and channel
    try {
      const guild = await client.guilds.fetch(giveaway.guildId);
      const guildSettings = await getGuildSettings(giveaway.guildId);
      const giveawaySettings = await prisma.giveawaySettings.findUnique({
        where: { guildId: giveaway.guildId },
      });

      if (!giveawaySettings?.channel) {
        Logging.error(`No channel set for giveaway in guild ${giveaway.guildId}`);
        continue;
      }

      const fetchedChannel = await client.channels
        .fetch(giveawaySettings.channel)
        .catch(() => null);

      if (!fetchedChannel?.isTextBased()) {
        // The channel is gone; retrying every minute would never succeed.
        Logging.error(
          `Giveaway ${giveaway.id}: announcement channel ${giveawaySettings.channel} is unavailable, deactivating`
        );
        await prisma.giveaway.update({
          where: { id: giveaway.id },
          data: { active: false },
        });
        continue;
      }

      const channel = fetchedChannel as TextChannel;

      // Disabling the entry buttons is cosmetic — a deleted announcement must
      // not stop the winner from being drawn.
      try {
        const message = await channel.messages.fetch(giveaway.messageId);

        if (message.components.length > 0) {
          const disabledComponents = message.components.map((row) => {
            const actionRow = ActionRowBuilder.from<ButtonBuilder>(row as any);
            actionRow.components.forEach((component) => {
              if (component instanceof ButtonBuilder) {
                component.setDisabled(true);
              }
            });
            return actionRow;
          });

          await message.edit({ components: disabledComponents });
        }
      } catch (err) {
        Logging.warn(`Giveaway ${giveaway.id}: could not disable entry buttons: ${err}`);
      }

      // Pick winner
      const participantIds = giveaway.giveaway_participants.map((p) => p.userId);

      // If no participants, send a "No participants" message
      if (participantIds.length === 0) {
        Logging.info(`No participants for giveaway ${giveaway.id}`);

        await channel.send({
          content: t(guildSettings?.language, 'giveaway_no_participants', {
            prize: giveaway.prize,
          }),
        });

        // Mark giveaway inactive
        await prisma.giveaway.update({
          where: { id: giveaway.id },
          data: { active: false },
        });
        continue;
      }

      const winnerId = getRandomElement(participantIds);

      if (!winnerId) continue;

      // Mark giveaway as inactive and winner in DB
      await prisma.giveaway.update({
        where: { id: giveaway.id },
        data: { active: false },
      });

      await prisma.giveawayParticipant.update({
        where: { giveawayId_userId: { giveawayId: giveaway.id, userId: winnerId } },
        data: { winner: true },
      });

      // Send claim message
      const user = await client.users.fetch(winnerId);

      const embed = new EmbedBuilder()
        .setColor(
          guildSettings?.primaryColor ? (guildSettings.primaryColor as `#${string}`) : '#2F3136'
        )
        .setTitle(
          t(guildSettings?.language, 'giveaway_winner_title', { username: user.displayName })
        )
        .setDescription(
          t(guildSettings?.language, 'giveaway_winner_description', { prize: giveaway.prize })
        );

      const claimRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_giveaway_${giveaway.id}_${winnerId}`)
          .setLabel('🎁')
          .setStyle(ButtonStyle.Success)
      );

      await channel.send({
        content: `<@${winnerId}>`,
        embeds: [embed],
        components: [claimRow],
        allowedMentions: { users: [winnerId] },
      });
    } catch (err: any) {
      // Unknown message / unknown channel / missing access: retrying every
      // minute can never succeed, so retire the giveaway instead.
      const permanent = [10003, 10008, 50001, 50013].includes(Number(err?.code));

      if (permanent) {
        await prisma.giveaway
          .update({ where: { id: giveaway.id }, data: { active: false } })
          .catch(() => null);
      }

      Logging.error(`Failed to process giveaway ${giveaway.id}: ${err}`);
    }
  }
}

/** Draws the winner of every giveaway that has ended. */
export default {
  name: 'giveaway-end',
  schedule: '* * * * *',

  async execute(client) {
    await endGiveaways(client);
  },
} satisfies Task;
