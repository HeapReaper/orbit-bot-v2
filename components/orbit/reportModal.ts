import { EmbedBuilder, MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import type { Component } from '../../types';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

const REPORT_CHANNEL_ID = '1499037474163527840';

async function sendToReportChannel(
  interaction: ModalSubmitInteraction,
  embed: EmbedBuilder
): Promise<void> {
  try {
    const channel = await interaction.client.channels.fetch(REPORT_CHANNEL_ID);
    if (!channel?.isSendable()) {
      Logging.error(`Orbit: Report channel ${REPORT_CHANNEL_ID} not found or not text-based`);
      return;
    }
    await channel.send({ embeds: [embed] });
  } catch (err) {
    Logging.error(`Orbit: Could not send to report channel: ${err}`);
  }
}

function buildEmbed(interaction: ModalSubmitInteraction, type: string): EmbedBuilder | null {
  const field = (id: string) => interaction.fields.getTextInputValue(id);
  const server = interaction.guild?.name ?? 'Unknown';

  switch (type) {
    case 'bug': {
      const embed = new EmbedBuilder()
        .setTitle(`Bug Report: ${field('bug_title')}`)
        .setColor('Red')
        .addFields(
          { name: 'Reporter', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Server', value: server, inline: true },
          { name: 'Description', value: field('bug_description') }
        )
        .setTimestamp();

      const steps = field('bug_steps');
      if (steps) embed.addFields({ name: 'Steps to Reproduce', value: steps });
      return embed;
    }

    case 'feature': {
      const embed = new EmbedBuilder()
        .setTitle(`Feature Request: ${field('feature_title')}`)
        .setColor('Blue')
        .addFields(
          { name: 'Requester', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Server', value: server, inline: true },
          { name: 'Description', value: field('feature_description') }
        )
        .setTimestamp();

      const reason = field('feature_reason');
      if (reason) embed.addFields({ name: 'Reason', value: reason });
      return embed;
    }

    case 'security':
      return new EmbedBuilder()
        .setTitle(`Security Report: ${field('security_title')}`)
        .setColor('Orange')
        .addFields(
          { name: 'Reporter', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Server', value: server, inline: true },
          { name: 'Severity', value: field('security_severity'), inline: true },
          { name: 'Description', value: field('security_description') }
        )
        .setTimestamp();

    case 'abuse': {
      const embed = new EmbedBuilder()
        .setTitle(`Abuse Report: ${field('abuse_type')}`)
        .setColor('Yellow')
        .addFields(
          { name: 'Reporter', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Server', value: server, inline: true },
          { name: 'Reported User', value: field('abuse_reported_user'), inline: true },
          { name: 'Description', value: field('abuse_description') }
        )
        .setTimestamp();

      const evidence = field('abuse_evidence');
      if (evidence) embed.addFields({ name: 'Evidence', value: evidence });
      return embed;
    }

    default:
      return null;
  }
}

export default {
  customId: /^orbit_(bug|feature|security|abuse)_modal$/,

  async execute(interaction) {
    if (!interaction.isModalSubmit() || !interaction.guild) return;

    const type = interaction.customId.split('_')[1]!;
    const embed = buildEmbed(interaction, type);
    if (!embed) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);

    await sendToReportChannel(interaction, embed);

    await interaction.reply({
      content: t(guildSettings?.language, `orbit_${type}_submitted`),
      flags: MessageFlags.Ephemeral,
    });
  },
} satisfies Component;
