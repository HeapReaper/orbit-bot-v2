import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ColorResolvable,
  EmbedBuilder,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { prisma } from '../lib/prisma';
import { Logging } from '../lib/logging';
import { getRandomElement } from '../lib/random';
import { t } from '../lib/i18n';

// Create a giveaway
export async function create(
  interaction: ChatInputCommandInteraction,
  giveawaySettings: any,
  guildSettings: any
) {
  const day = interaction.options.getInteger('day', true);
  const month = interaction.options.getInteger('month', true);
  const year = interaction.options.getInteger('year', true);
  const time = interaction.options.getString('time', true);
  const winners = interaction.options.getInteger('number_of_winners', true);
  const prize = interaction.options.getString('prize', true);
  const extraRules = interaction.options.getString('extra_requirements', true);
  const mentionEveryone = interaction.options.getBoolean('mention_everyone', true);

  const formattedDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${time}:00`;
  const endsAt = new Date(formattedDate);

  // Every failure below has to answer the interaction. Returning silently left
  // the user staring at "The application did not respond".
  if (!/^\d{1,2}:\d{2}$/.test(time) || isNaN(endsAt.getTime())) {
    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_invalid_date'),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (endsAt.getTime() <= Date.now()) {
    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_end_date_in_past'),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (winners !== 1) {
    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_winners_must_be_one'),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  let giveaway;

  try {
    giveaway = await prisma.giveaway.create({
      data: {
        guildId: interaction.guild!.id,
        endsAt,
        winners,
        prize,
        extraRules,
      },
    });
  } catch (err) {
    Logging.error(`Error creating giveaway: ${err}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_something_went_wrong'),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.reply({
    content: t(guildSettings?.language, 'giveaway_created_with_id', {
      id: giveaway.id.toString(),
    }),
    flags: [MessageFlags.Ephemeral],
  });

  try {
    await sendGiveawayEmbed(
      interaction,
      winners,
      prize,
      extraRules,
      mentionEveryone,
      giveaway,
      giveawaySettings,
      guildSettings
    );
  } catch (err) {
    // The interaction is already answered at this point, so follow up instead
    // of replying again (which throws InteractionAlreadyReplied).
    Logging.error(`Error announcing giveaway ${giveaway.id}: ${err}`);
    await interaction
      .followUp({
        content: t(guildSettings?.language, 'giveaway_something_went_wrong'),
        flags: [MessageFlags.Ephemeral],
      })
      .catch(() => null);
  }
}

// Delete a giveaway
export async function deleteGiveaway(
  interaction: ChatInputCommandInteraction,
  giveawaySettings: any,
  guildSettings: any
) {
  const giveaway = await findGiveawayForGuild(interaction);

  if (!giveaway) {
    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_not_found'),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channel = await fetchAnnouncementChannel(interaction.client, giveawaySettings);

  try {
    if (channel && giveaway.messageId) await channel.messages.delete(giveaway.messageId);
  } catch (err) {
    Logging.error(`Failed to delete giveaway message: ${err}`);
  }

  await prisma.giveaway.delete({ where: { id: giveaway.id } });
  await interaction.reply({
    content: t(guildSettings?.language, 'giveaway_deleted'),
    flags: [MessageFlags.Ephemeral],
  });
}

// Reroll a giveaway
export async function reroll(
  interaction: ChatInputCommandInteraction,
  giveawaySettings: any,
  guildSettings: any
) {
  const giveaway = await findGiveawayForGuild(interaction);

  if (!giveaway) {
    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_not_found'),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const participants = await prisma.giveawayParticipant.findMany({
    where: { giveawayId: giveaway.id, winner: false },
  });

  const winner = getRandomElement(participants);

  if (!winner) {
    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_no_participants_to_reroll'),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channel = await fetchAnnouncementChannel(interaction.client, giveawaySettings);

  if (!channel) {
    await interaction.reply({
      content: t(guildSettings?.language, 'giveaway_something_went_wrong'),
      flags: [MessageFlags.Ephemeral],
    });
    Logging.error('Could not reroll giveaway because the announcement channel is missing');
    return;
  }

  // Remove old winner
  await prisma.giveawayParticipant.updateMany({
    where: { giveawayId: giveaway.id, winner: true },
    data: { winner: false },
  });

  // Add new winner
  await prisma.giveawayParticipant.update({
    where: { giveawayId_userId: { giveawayId: giveaway.id, userId: winner.userId } },
    data: { winner: true },
  });

  const user = await interaction.client.users.fetch(winner.userId).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor('Blue' as ColorResolvable)
    .setTitle(
      t(guildSettings?.language, 'giveaway_winner_title', {
        username: user?.displayName ?? t(guildSettings?.language, 'unknown_user'),
      })
    )
    .setDescription(
      t(guildSettings?.language, 'giveaway_winner_description', { prize: giveaway.prize })
    );

  const claimRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_giveaway_${giveaway.id}_${winner.userId}`)
      .setLabel('🎁')
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({ content: `<@${winner.userId}>`, embeds: [embed], components: [claimRow] });

  await interaction.reply({
    content: t(guildSettings?.language, 'giveaway_rerolled'),
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * Resolves the `id` option to a giveaway *in the invoking guild*. Looking it
 * up by primary key alone let a moderator in one server delete or reroll
 * another server's giveaway by guessing the number.
 */
async function findGiveawayForGuild(interaction: ChatInputCommandInteraction) {
  const id = Number.parseInt(interaction.options.getString('id', true), 10);
  if (!Number.isInteger(id)) return null;

  return prisma.giveaway.findFirst({ where: { id, guildId: interaction.guild!.id } });
}

/** The configured announcement channel, or null when it is gone or not a text channel. */
export async function fetchAnnouncementChannel(
  client: Client,
  giveawaySettings: any
): Promise<TextChannel | null> {
  if (!giveawaySettings?.channel) return null;

  const channel = await client.channels.fetch(giveawaySettings.channel).catch(() => null);

  return channel?.isTextBased() ? (channel as TextChannel) : null;
}

// List giveaways
export async function list(
  interaction: ChatInputCommandInteraction,
  giveawaySettings: any,
  guildSettings: any
) {
  const giveaways = await prisma.giveaway.findMany({
    where: { guildId: interaction.guild!.id, active: true },
  });

  const embed = new EmbedBuilder().setTitle(t(guildSettings?.language, 'giveaway_list_title'));

  if (giveaways.length === 0) {
    // Discord rejects an embed with neither description nor fields.
    embed.setDescription(t(guildSettings?.language, 'giveaway_list_empty'));
  }

  // An embed holds at most 25 fields.
  for (const g of giveaways.slice(0, 25)) {
    embed.addFields({
      name: `[${g.id}] - ${g.prize}`.slice(0, 256),
      value: t(guildSettings?.language, 'giveaway_list_ends_at', {
        date: `<t:${Math.floor(g.endsAt.getTime() / 1000)}:f>`,
      }),
    });
  }

  if (giveaways.length > 25) {
    embed.setFooter({
      text: t(guildSettings?.language, 'giveaway_list_truncated', {
        count: (giveaways.length - 25).toString(),
      }),
    });
  }

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

// Send giveaway embed
async function sendGiveawayEmbed(
  interaction: ChatInputCommandInteraction,
  amountWinners: number,
  prize: string,
  terms: string,
  tagEveryone: boolean,
  giveaway: any,
  giveawaySettings: any,
  guildSettings: any
) {
  const channel = await fetchAnnouncementChannel(interaction.client, giveawaySettings);

  if (!channel) {
    throw new Error(`Giveaway announcement channel ${giveawaySettings?.channel} is unavailable`);
  }

  const now = new Date();

  const unixTimestamp = Math.floor(giveaway.endsAt.getTime() / 1000);

  const giveawayEmbed = new EmbedBuilder()
    .setTitle(`${prize}`)
    .setDescription(t(guildSettings?.language, 'giveaway_embed_description', { terms }))
    .setColor('Blue' as ColorResolvable)
    .addFields(
      {
        name: t(guildSettings?.language, 'giveaway_field_ends_at'),
        value: `<t:${unixTimestamp}:R>`,
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'giveaway_field_created_by'),
        value: `<@${interaction.user.id}>`,
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'giveaway_field_participants'),
        value: '0',
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'giveaway_field_winners'),
        value: `${amountWinners}`,
        inline: false,
      }
    )
    .setFooter({
      text: t(guildSettings?.language, 'giveaway_footer_created_at', {
        date: now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }),
      }),
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('enter_giveaway').setLabel('🎉').setStyle(ButtonStyle.Primary)
  );

  const message = await channel.send({
    content: t(guildSettings?.language, 'giveaway_announce_content', {
      everyone: tagEveryone ? '@everyone' : '',
    }),
    embeds: [giveawayEmbed],
    components: [row],
    // The prize and terms come straight from the command options, so restrict
    // what the announcement is allowed to ping to the requested @everyone.
    allowedMentions: { parse: tagEveryone ? ['everyone'] : [] },
  });

  // Update messageId in DB
  await prisma.giveaway.update({
    where: { id: giveaway.id },
    data: { messageId: message.id },
  });
}
