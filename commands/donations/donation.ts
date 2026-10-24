import {
  ChannelType,
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { Logging } from '../../lib/logging';
import { t } from '../../lib/i18n';

async function create(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guildId!);
  const donationsSettings = await getDonationSettings(interaction.guildId!);

  if (!donationsSettings || !donationsSettings.enabled) {
    await interaction.reply({
      content: t(guildSettings?.language, 'donation_not_configured'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId!;
  const authorId = interaction.user.id;

  const channel = interaction.options.getChannel('channel', true) as TextChannel;
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description', true);
  const goalAmount = interaction.options.getInteger('goalamount', true);
  const stopOnGoal = interaction.options.getBoolean('stopongoal') ?? true;
  const notifyChannel = interaction.options.getChannel('notifychannel', true);
  const mentionRole = interaction.options.getRole('mentionrole');

  try {
    let sentMessage;
    if (channel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable)
        .setDescription(description)
        .addFields(
          {
            name: t(guildSettings?.language, 'donation_field_target'),
            value: `${donationsSettings.currency} ${goalAmount}`,
            inline: true,
          },
          {
            name: t(guildSettings?.language, 'donation_field_fetched'),
            value: `${donationsSettings.currency} 0`,
            inline: true,
          }
        )
        .setFooter({
          text: t(guildSettings?.language, 'donation_footer_created_by', {
            user: interaction.user.username,
            id: '',
          }),
        });

      sentMessage = await channel.send({ embeds: [embed] });
    }

    const donationGoal = await prisma.donationGoals.create({
      data: {
        guildId,
        channelId: channel.id,
        authorId,
        title,
        description,
        goalAmount,
        stopOnGoal,
        notifyChannel: notifyChannel.id,
        mentionRole: mentionRole?.id ?? null,
        messageId: sentMessage?.id ?? '',
      },
    });

    // Update footer van embed met ID
    if (sentMessage && sentMessage.embeds.length > 0) {
      const updatedEmbed = EmbedBuilder.from(sentMessage.embeds[0])
        .setFooter({
          text: t(guildSettings?.language, 'donation_footer_created_by', {
            user: interaction.user.username,
            id: donationGoal.id.toString(),
          }),
        })
        .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable);

      await sentMessage.edit({ embeds: [updatedEmbed] });
    }

    // Bevestiging
    await interaction.reply({
      content: t(guildSettings?.language, 'donation_created', { title }),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    Logging.error(`Could not make new donation goal: ${error}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: t(guildSettings?.language, 'donation_create_error'),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

async function status(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger('id', true);
  const guildSettings = await getGuildSettings(interaction.guildId!);

  try {
    const goal = await prisma.donationGoals.findFirst({
      where: {
        id,
        guildId: interaction.guild!.id,
      },
      include: { donations: true },
    });

    if (!goal) {
      await interaction.reply({
        content: t(guildSettings?.language, 'donation_not_found'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const totalDonations = goal.donations.reduce((sum, d) => sum + d.amount, 0);
    const progress = Math.min((totalDonations / goal.goalAmount) * 100, 100).toFixed(2);

    const embed = new EmbedBuilder()
      .setTitle(t(guildSettings?.language, 'donation_status_title', { title: goal.title }))
      .setDescription(goal.description)
      .addFields(
        {
          name: t(guildSettings?.language, 'donation_field_target'),
          value: `${goal.goalAmount}`,
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'donation_field_fetched'),
          value: `${totalDonations}`,
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'donation_field_progress'),
          value: `${progress}%`,
          inline: true,
        }
      )
      .setFooter({
        text: t(guildSettings?.language, 'donation_footer_set_up_by', { user: goal.authorId }),
      })
      .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    Logging.error(`Donations: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'donation_status_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function add(interaction: ChatInputCommandInteraction): Promise<void> {
  const donationSettings = await getDonationSettings(interaction.guildId!);
  const guildSettings = await getGuildSettings(interaction.guildId!);

  if (!donationSettings || !donationSettings.enabled) {
    await interaction.reply({
      content: t(guildSettings?.language, 'donation_not_configured'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const id = interaction.options.getInteger('id', true);

  const donationGoal = await prisma.donationGoals.findUnique({
    where: {
      id,
      guildId: interaction.guildId!,
    },
  });

  if (!donationGoal) {
    await interaction.reply({
      content: t(guildSettings?.language, 'donation_goal_not_found'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Add the donation to the database
    await prisma.donations.create({
      data: {
        guildId: interaction.guildId!,
        authorId: user.id,
        goalId: id,
        amount,
      },
    });

    // Get total donations for this goal
    const totalDonations = await prisma.donations.aggregate({
      _sum: { amount: true },
      where: { goalId: id },
    });

    const totalAmount = totalDonations._sum.amount ?? 0;

    const notifyChannel = await interaction.guild?.channels.fetch(donationGoal.notifyChannel);
    const channelOfEmbed = await interaction.guild?.channels.fetch(donationGoal.channelId);

    // Edit the original goal message
    if (channelOfEmbed?.isTextBased() && donationGoal.messageId) {
      try {
        const message = await channelOfEmbed.messages.fetch(donationGoal.messageId);

        const goalEmbed = new EmbedBuilder()
          .setTitle(donationGoal.title)
          .setDescription(donationGoal.description || '')
          .addFields(
            {
              name: t(guildSettings?.language, 'donation_field_target'),
              value: `${donationSettings.currency} ${donationGoal.goalAmount}`,
              inline: true,
            },
            {
              name: t(guildSettings?.language, 'donation_field_fetched'),
              value: `${donationSettings.currency} ${totalAmount}`,
              inline: true,
            }
          )
          .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable)
          .setFooter({
            text: t(guildSettings?.language, 'donation_footer_created_by', {
              user: interaction.user.username,
              id: donationGoal.id.toString(),
            }),
          })
          .setTimestamp();

        await message.edit({ embeds: [goalEmbed] });
      } catch (err) {
        Logging.error(`Failed to fetch/edit donation goal message: ${err}`);
      }
    }

    // Determine which notification to send
    const notificationEmbed = new EmbedBuilder()
      .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable)
      .setTimestamp();

    if (totalAmount >= donationGoal.goalAmount) {
      notificationEmbed
        .setTitle(t(guildSettings?.language, 'donation_closed_title'))
        .setDescription(
          t(guildSettings?.language, 'donation_closed_description', {
            title: donationGoal.title,
            currency: donationSettings.currency ?? '',
            amount: totalAmount.toString(),
          })
        )
        .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable);
    } else {
      notificationEmbed
        .setTitle(t(guildSettings?.language, 'donation_new_title'))
        .setDescription(
          t(guildSettings?.language, 'donation_new_description', {
            user: user.id,
            currency: donationSettings.currency ?? '',
            amount: amount.toString(),
            title: donationGoal.title,
          })
        )
        .addFields({
          name: t(guildSettings?.language, 'donation_field_total'),
          value: t(guildSettings?.language, 'donation_total_value', {
            currency: donationSettings.currency ?? '',
            total: totalAmount.toString(),
            goal: donationGoal.goalAmount.toString(),
          }),
        })
        .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable);
    }

    if (notifyChannel?.isTextBased()) {
      await notifyChannel.send({ embeds: [notificationEmbed] });
    }

    await interaction.reply({
      content: t(guildSettings?.language, 'donation_added', {
        currency: donationSettings.currency ?? '',
        amount: amount.toString(),
        title: donationGoal.title,
      }),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    Logging.error(`Donations: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'donation_generic_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function remove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guildId!);
  const user = interaction.options.getUser('user', true);
  const goalId = interaction.options.getInteger('id', true);

  try {
    // Find the donation for this user in this goal
    const donation = await prisma.donations.findFirst({
      where: {
        goalId,
        authorId: user.id,
        guildId: interaction.guildId!,
      },
      orderBy: { id: 'desc' }, // Remove the latest one if multiple
    });

    if (!donation) {
      await interaction.reply({
        content: t(guildSettings?.language, 'donation_no_donation_found'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Fetch the related donation goal
    const donationGoal = await prisma.donationGoals.findUnique({
      where: { id: goalId },
    });

    if (!donationGoal) {
      await interaction.reply({
        content: t(guildSettings?.language, 'donation_goal_missing'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Delete the donation
    await prisma.donations.delete({ where: { id: donation.id } });

    // Recalculate total donations
    const totalDonations = await prisma.donations.aggregate({
      _sum: { amount: true },
      where: { goalId },
    });
    const totalAmount = totalDonations._sum.amount ?? 0;

    const donationSettings = await getDonationSettings(interaction.guildId!);

    // Update the original goal message
    const channelOfEmbed = await interaction.guild?.channels.fetch(donationGoal.channelId);
    if (channelOfEmbed?.isTextBased() && donationGoal.messageId) {
      try {
        const message = await channelOfEmbed.messages.fetch(donationGoal.messageId);

        const goalEmbed = new EmbedBuilder()
          .setTitle(donationGoal.title)
          .setDescription(donationGoal.description || '')
          .addFields(
            {
              name: t(guildSettings?.language, 'donation_field_target'),
              value: `${donationSettings?.currency ?? ''} ${donationGoal.goalAmount}`,
              inline: true,
            },
            {
              name: t(guildSettings?.language, 'donation_field_fetched'),
              value: `${donationSettings?.currency ?? ''} ${totalAmount}`,
              inline: true,
            }
          )
          .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable)
          .setFooter({
            text: t(guildSettings?.language, 'donation_footer_created_by', {
              user: interaction.user.username,
              id: donationGoal.id.toString(),
            }),
          })
          .setTimestamp();

        await message.edit({ embeds: [goalEmbed] });
      } catch (err) {
        Logging.error(`Failed to fetch/edit donation goal message: ${err}`);
      }
    }

    await interaction.reply({
      content: t(guildSettings?.language, 'donation_removed', {
        currency: donationSettings?.currency ?? '',
        amount: donation.amount.toString(),
        title: donationGoal.title,
        tag: user.tag,
      }),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    Logging.error(`Donations: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'donation_remove_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function deleteGoal(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guildId!);
  const id = interaction.options.getInteger('id', true);

  try {
    const goal = await prisma.donationGoals.findFirst({
      where: {
        id,
        guildId: interaction.guild!.id,
      },
    });
    if (!goal) {
      await interaction.reply({
        content: t(guildSettings?.language, 'donation_does_not_exist'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const donationGoal = await prisma.donationGoals.findUnique({
      where: {
        id: id,
        guildId: interaction.guildId!,
      },
    });

    if (!donationGoal) {
      await interaction.reply({
        content: t(guildSettings?.language, 'donation_goal_not_found_id_hint'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await prisma.donationGoals.delete({
      where: {
        id,
        guildId: interaction.guildId!,
      },
    });

    await interaction.reply({
      content: t(guildSettings?.language, 'donation_deleted', { title: goal.title }),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    Logging.error(`Donations: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'donation_generic_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function getDonationSettings(guildId: string) {
  return prisma.donationsSettings.findUnique({ where: { guildId } });
}

export default {
  data: new SlashCommandBuilder()
    .setName('donation')
    .setDescription('Manage and create donations!')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    // Subcommand: create
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create a new donation goal')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel where donation updates are posted')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('Title of the donation goal')
            .setMaxLength(30)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Description of the donation goal')
            .setMaxLength(120)
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('goalamount')
            .setDescription('Goal amount for this donation')
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName('notifychannel')
            .setDescription('Channel to notify when donations are made or goal reached')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addBooleanOption((option) =>
          option
            .setName('stopongoal')
            .setDescription('Stop accepting donations when goal is reached')
            .setRequired(false)
        )
        .addRoleOption((option) =>
          option
            .setName('mentionrole')
            .setDescription('Role to mention when goal is reached')
            .setRequired(false)
        )
    )

    // Subcommand: status
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('View the current donation goal status')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Donation id').setRequired(true)
        )
    )

    // Subcommand: add
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a donation to the current goal')
        .addUserOption((option) =>
          option.setName('user').setDescription('User making the donation').setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName('amount').setDescription('Amount of the donation').setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Donation id').setRequired(true)
        )
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove a donation to the current goal')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('User to remove the donation from')
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Donation id').setRequired(true)
        )
    )

    // Subcommand: end
    .addSubcommand((subcommand) =>
      subcommand
        .setName('end')
        .setDescription('End the current donation goal')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Donation id').setRequired(true)
        )
    ),

  async execute(interaction) {
    // The registered "end" subcommand had no handler in v1, and the "delete"
    // handler had no registered subcommand; both are kept as they were.
    switch (interaction.options.getSubcommand(false)) {
      case 'create':
        return create(interaction);
      case 'status':
        return status(interaction);
      case 'add':
        return add(interaction);
      case 'delete':
        return deleteGoal(interaction);
      case 'remove':
        return remove(interaction);
    }
  },
} satisfies Command;
