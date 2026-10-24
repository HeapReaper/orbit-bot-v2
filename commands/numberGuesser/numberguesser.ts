import {
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

async function start(interaction: ChatInputCommandInteraction, guildSettings: any): Promise<void> {
  const min = interaction.options.getInteger('min') ?? 1;
  const max = interaction.options.getInteger('max') ?? 100;
  const description = interaction.options.getString('description') ?? null;
  const cooldown = interaction.options.getInteger('cooldown') ?? 0;

  if (min >= max) {
    await interaction.reply({
      content: t(guildSettings?.language, 'numberguesser_min_max_invalid'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existingGame = await prisma.numberGuesserGame.findFirst({
    where: { channelId: interaction.channelId, active: true },
  });

  if (existingGame) {
    await interaction.reply({
      content: t(guildSettings?.language, 'numberguesser_already_active'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const secretNumber = Math.floor(Math.random() * (max - min + 1)) + min;

  const game = await prisma.numberGuesserGame.create({
    data: {
      guildId: interaction.guild!.id,
      channelId: interaction.channelId,
      minNumber: min,
      maxNumber: max,
      secretNumber,
      description,
      cooldownSeconds: cooldown,
    },
  });

  const embed = new EmbedBuilder()
    .setColor('Blue' as ColorResolvable)
    .setTitle(t(guildSettings?.language, 'numberguesser_start_title'))
    .setDescription(
      description
        ? `${description}\n\n${t(guildSettings?.language, 'numberguesser_start_description', { min: min.toString(), max: max.toString() })}`
        : t(guildSettings?.language, 'numberguesser_start_description', {
            min: min.toString(),
            max: max.toString(),
          })
    )
    .addFields(
      {
        name: t(guildSettings?.language, 'numberguesser_field_range'),
        value: `${min} – ${max}`,
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'numberguesser_field_started_by'),
        value: `<@${interaction.user.id}>`,
        inline: true,
      }
    )
    .setFooter({
      text: t(guildSettings?.language, 'numberguesser_footer_game_id', { id: game.id.toString() }),
    });

  if (cooldown > 0) {
    embed.addFields({
      name: t(guildSettings?.language, 'numberguesser_field_cooldown'),
      value: t(guildSettings?.language, 'numberguesser_cooldown_value', {
        seconds: cooldown.toString(),
      }),
      inline: true,
    });
  }

  await interaction.reply({
    content: t(guildSettings?.language, 'numberguesser_started_content'),
    embeds: [embed],
  });

  const message = await interaction.fetchReply();
  await prisma.numberGuesserGame.update({
    where: { id: game.id },
    data: { messageId: message.id },
  });
}

async function stop(interaction: ChatInputCommandInteraction, guildSettings: any): Promise<void> {
  const game = await prisma.numberGuesserGame.findFirst({
    where: { channelId: interaction.channelId, active: true },
  });

  if (!game) {
    await interaction.reply({
      content: t(guildSettings?.language, 'numberguesser_no_active_game'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await prisma.numberGuesserGame.update({
    where: { id: game.id },
    data: { active: false, endedAt: new Date() },
  });

  await interaction.reply({
    content: t(guildSettings?.language, 'numberguesser_stopped', {
      answer: game.secretNumber.toString(),
    }),
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('numberguesser')
    .setDescription('Commands for the number guessing game')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start a new number guessing game in this channel')
        .addIntegerOption((option) =>
          option
            .setName('min')
            .setDescription('Minimum number (default: 1)')
            .setMinValue(1)
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName('max')
            .setDescription('Maximum number (default: 100)')
            .setMinValue(2)
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Optional description shown in the game embed')
            .setMaxLength(500)
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName('cooldown')
            .setDescription('Cooldown in seconds between guesses per user (default: 0)')
            .setMinValue(0)
            .setMaxValue(3600)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop the active number guessing game in this channel')
    ),

  async execute(interaction) {
    if (!interaction.guild) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: t(guildSettings?.language, 'missing_permissions'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    switch (interaction.options.getSubcommand(true)) {
      case 'start':
        return start(interaction, guildSettings);
      case 'stop':
        return stop(interaction, guildSettings);
    }
  },
} satisfies Command;
