import {
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types';
import { Logging } from '../../lib/logging';
import { formatDate } from '../../lib/formatDate';
import { GuildLogger } from '../../lib/guildLog';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

async function birthdayAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  GuildLogger.info(
    interaction.guild.id,
    `User ${interaction.user.username} ran the command /birthday add`
  );

  const guildSettings = await getGuildSettings(interaction.guild.id);

  try {
    // Check if birthday already exists
    const existingBirthday = await prisma.birthday.findFirst({
      where: {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
      },
    });

    if (existingBirthday) {
      await interaction.reply({
        content: t(guildSettings?.language, 'birthday_already_added'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get birthdate from options
    const year = interaction.options.getInteger('year');
    const month = interaction.options.getInteger('month');
    const day = interaction.options.getInteger('day');

    if (!year || !month || !day) {
      await interaction.reply({
        content: t(guildSettings?.language, 'birthday_invalid_date'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const birthdate = new Date(Date.UTC(year, month - 1, day));

    await prisma.birthday.create({
      data: {
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        birthdate,
      },
    });

    await interaction.reply({
      content: t(guildSettings?.language, 'birthday_added'),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    Logging.error(`Error adding birthday: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'birthday_generic_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function birthdayRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  GuildLogger.info(
    interaction.guild.id,
    `User ${interaction.user.username} ran the command /birthday remove`
  );

  const guildSettings = await getGuildSettings(interaction.guild.id);

  try {
    const existingBirthday = await prisma.birthday.findFirst({
      where: {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
      },
    });

    if (!existingBirthday) {
      await interaction.reply({
        content: t(guildSettings?.language, 'birthday_not_in_list'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await prisma.birthday.deleteMany({
      where: {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
      },
    });

    await interaction.reply({
      content: t(guildSettings?.language, 'birthday_deleted'),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    Logging.error(`Error deleting birthday: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'birthday_generic_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function birthdayList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  GuildLogger.info(
    interaction.guild.id,
    `User ${interaction.user.username} ran the command /birthday list`
  );

  // Fetch bot settings (for embed color)
  const res = await prisma.botSettings.findFirst();
  const guildSettings = await getGuildSettings(interaction.guild.id);

  if (!interaction.member) {
    await interaction.reply({
      content: t(guildSettings?.language, 'birthday_generic_error'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check permissions
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
    await interaction.reply({
      content: t(guildSettings?.language, 'birthday_missing_permissions'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const birthdays = await prisma.birthday.findMany({
      where: {
        guildId: interaction.guild.id,
      },
    });

    const embed = new EmbedBuilder()
      .setColor((res?.primaryColor as ColorResolvable) ?? 'Blue')
      .setTitle(t(guildSettings?.language, 'birthday_list_title'));

    for (const birthday of birthdays) {
      const user = await interaction.client.users.fetch(birthday.userId).catch(() => null);
      embed.addFields({
        name: user ? user.username : birthday.userId,
        value: formatDate(birthday.birthdate),
      });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    Logging.error(`Error listing birthdays: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'birthday_generic_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Add your birthday to the server!')
    .addSubcommand((add) =>
      add
        .setName('add')
        .setDescription('Add a new birthday to the server!')
        .addIntegerOption((option) =>
          option
            .setName('day')
            .setDescription('Like 11')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31)
        )
        .addIntegerOption((option) =>
          option
            .setName('month')
            .setDescription('Like 05')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(12)
        )
        .addIntegerOption((option) =>
          option.setName('year').setDescription('Like 2001').setRequired(true)
        )
    )
    .addSubcommand((remove) => remove.setName('delete').setDescription('Delete your birthday!'))
    .addSubcommand((list) => list.setName('list').setDescription('birthday list (admin only)')),

  async execute(interaction) {
    switch (interaction.options.getSubcommand(false)) {
      case 'add':
        return birthdayAdd(interaction);
      case 'delete':
        return birthdayRemove(interaction);
      case 'list':
        return birthdayList(interaction);
    }
  },
} satisfies Command;
