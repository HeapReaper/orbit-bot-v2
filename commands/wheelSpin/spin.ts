import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Command } from '../../types';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import {
  getWheelSpinSettings,
  INPUT_ID,
  MAX_NAMES,
  MIN_NAMES,
  MODAL_ID,
} from '../../services/wheelSpin';

export default {
  data: new SlashCommandBuilder()
    .setName('spin')
    .setDescription('Spin the wheel of names! Fill in the names via the form.'),

  async execute(interaction) {
    if (!interaction.guild) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);
    const settings = await getWheelSpinSettings(interaction.guild.id);

    if (!settings || !settings.enabled) {
      await interaction.reply({
        content: t(guildSettings?.language, 'wheelspin_not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!settings.permissionMembers) {
      const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
      if (!hasPermission) {
        await interaction.reply({
          content: t(guildSettings?.language, 'wheelspin_not_enabled'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const modal = new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle(t(guildSettings?.language, 'wheelspin_modal_title'));

    const namesInput = new TextInputBuilder()
      .setCustomId(INPUT_ID)
      .setLabel(
        t(guildSettings?.language, 'wheelspin_modal_label', {
          min: MIN_NAMES.toString(),
          max: MAX_NAMES.toString(),
        })
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(500)
      .setPlaceholder('Alice\nBob\nCharlie\nDave');

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(namesInput));

    await interaction.showModal(modal);
  },
} satisfies Command;
