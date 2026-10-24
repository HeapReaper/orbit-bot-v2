import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { t } from '../../lib/i18n';
import { getGuildSettings } from '../../lib/guildSettings';

function parseDateTime(date?: string, time?: string): Date | null {
  try {
    let datePart: string;

    if (date) {
      const parts = date.split('-').map(Number);

      if (parts.length !== 3) return null;

      let yyyy: number, mm: number, dd: number;

      if (parts[0]! > 31) {
        [yyyy, mm, dd] = parts as [number, number, number];
      } else {
        [dd, mm, yyyy] = parts as [number, number, number];
      }

      datePart = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    } else {
      const today = new Date();
      datePart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }

    if (!time) return null;

    const dateTime = new Date(`${datePart} ${time}`);

    return isNaN(dateTime.getTime()) ? null : dateTime;
  } catch {
    return null;
  }
}

async function remindMe(interaction: ChatInputCommandInteraction, guildSettings: any) {
  const dateOption = interaction.options.getString('date');
  const timeOption = interaction.options.getString('time', true);
  const message = interaction.options.getString('message', true);

  const remindAt = parseDateTime(dateOption ?? undefined, timeOption);

  if (!remindAt || remindAt < new Date()) {
    return interaction.reply({
      content: t(guildSettings?.language, 'timekeeper_invalid_datetime'),
      flags: MessageFlags.Ephemeral,
    });
  }

  await prisma.reminder.create({
    data: {
      message,
      remindAt,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId ?? undefined,
    },
  });

  await interaction.reply({
    content: t(guildSettings?.language, 'reminder_set'),
    flags: MessageFlags.Ephemeral,
  });
}

async function remindServer(interaction: ChatInputCommandInteraction, guildSettings: any) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
    await interaction.reply({
      content: t(guildSettings?.language, 'no_permission'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dateOption = interaction.options.getString('date');
  const timeOption = interaction.options.getString('time', true);
  const message = interaction.options.getString('message', true);

  const remindAt = parseDateTime(dateOption ?? undefined, timeOption);

  if (!remindAt || remindAt < new Date()) {
    return interaction.reply({
      content: t(guildSettings?.language, 'timekeeper_invalid_datetime'),
      flags: MessageFlags.Ephemeral,
    });
  }

  await prisma.reminder.create({
    data: {
      userId: 'server',
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      message,
      remindAt,
      isActive: true,
    },
  });

  await interaction.reply({
    content: t(guildSettings?.language, 'server_reminder_set'),
    flags: MessageFlags.Ephemeral,
  });
}

async function listReminders(interaction: ChatInputCommandInteraction, guildSettings: any) {
  const reminders = await prisma.reminder.findMany({
    where: {
      isActive: true,
      userId: interaction.user.id,
    },
    orderBy: { remindAt: 'asc' },
  });

  if (reminders.length === 0) {
    await interaction.reply({
      content: t(guildSettings?.language, 'no_reminders'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const list = reminders
    .map((r) =>
      t(guildSettings?.language, 'timekeeper_reminder_list_item', {
        channel: r.channelId,
        message: r.message,
        date: r.remindAt.toLocaleString(),
      })
    )
    .join('\n');

  await interaction.reply({ content: list, flags: MessageFlags.Ephemeral });
}

export default {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Reminder commands')
    .addSubcommand((sub) =>
      sub
        .setName('me')
        .setDescription('Set a personal reminder')
        .addStringOption((opt) =>
          opt.setName('time').setDescription('Time e.g. 23:19, 08:00').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Reminder message').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('date')
            .setDescription('Optional date in DD-MM-YYYY format')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('server')
        .setDescription('Set a server-wide reminder')
        .addStringOption((opt) =>
          opt.setName('time').setDescription('Time e.g. 23:19, 08:00').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Reminder message').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('date')
            .setDescription('Optional date in DD-MM-YYYY format')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List your pending reminders')),

  async execute(interaction) {
    if (!interaction.guild) return;

    const timeKeeperSettings = await prisma.timeKeeperSettings.findUnique({
      where: { guildId: interaction.guild.id },
    });

    const guildSettings = await getGuildSettings(interaction.guild.id);

    if (!timeKeeperSettings) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_configured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!timeKeeperSettings.enabled) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    switch (interaction.options.getSubcommand()) {
      case 'me':
        return remindMe(interaction, guildSettings);
      case 'server':
        return remindServer(interaction, guildSettings);
      case 'list':
        return listReminders(interaction, guildSettings);
    }
  },
} satisfies Command;
