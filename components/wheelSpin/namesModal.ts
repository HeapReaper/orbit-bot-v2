import { AttachmentBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { Component } from '../../types';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { generateWheelSpinGif } from '../../services/wheelSpinner';
import {
  getWheelSpinSettings,
  INPUT_ID,
  MAX_NAMES,
  MIN_NAMES,
  MODAL_ID,
} from '../../services/wheelSpin';

/** Submit of the /spin form: renders and posts the spinning wheel GIF. */
export default {
  customId: MODAL_ID,

  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;
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

    const raw = interaction.fields.getTextInputValue(INPUT_ID);
    const names = raw
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    if (names.length < MIN_NAMES) {
      await interaction.reply({
        content: t(guildSettings?.language, 'wheelspin_min_names', { min: MIN_NAMES.toString() }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (names.length > MAX_NAMES) {
      await interaction.reply({
        content: t(guildSettings?.language, 'wheelspin_max_names', { max: MAX_NAMES.toString() }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const gifBuffer = await generateWheelSpinGif(names);
      const attachment = new AttachmentBuilder(gifBuffer, { name: 'wheelspin.gif' });

      await interaction.editReply({
        content: t(guildSettings?.language, 'wheelspin_spinning', {
          count: names.length.toString(),
        }),
        files: [attachment],
      });
    } catch (err) {
      Logging.error(`WheelSpin GIF generation failed: ${err}`);
      await interaction.editReply({
        content: t(guildSettings?.language, 'wheelspin_error'),
      });
    }
  },
} satisfies Component;
