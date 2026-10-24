import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Command } from '../../types';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

interface ModalField {
  id: string;
  labelKey: string;
  style: TextInputStyle;
  required: boolean;
  maxLength: number;
}

/** The four report forms; their submits are handled in components/orbit/reportModal.ts. */
const MODALS: Record<string, { titleKey: string; fields: ModalField[] }> = {
  bug: {
    titleKey: 'orbit_bug_modal_title',
    fields: [
      {
        id: 'bug_title',
        labelKey: 'orbit_bug_label_title',
        style: TextInputStyle.Short,
        required: true,
        maxLength: 256,
      },
      {
        id: 'bug_description',
        labelKey: 'orbit_bug_label_description',
        style: TextInputStyle.Paragraph,
        required: true,
        maxLength: 1000,
      },
      {
        id: 'bug_steps',
        labelKey: 'orbit_bug_label_steps',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1000,
      },
    ],
  },
  feature: {
    titleKey: 'orbit_feature_modal_title',
    fields: [
      {
        id: 'feature_title',
        labelKey: 'orbit_feature_label_title',
        style: TextInputStyle.Short,
        required: true,
        maxLength: 256,
      },
      {
        id: 'feature_description',
        labelKey: 'orbit_feature_label_description',
        style: TextInputStyle.Paragraph,
        required: true,
        maxLength: 1000,
      },
      {
        id: 'feature_reason',
        labelKey: 'orbit_feature_label_reason',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1000,
      },
    ],
  },
  security: {
    titleKey: 'orbit_security_modal_title',
    fields: [
      {
        id: 'security_title',
        labelKey: 'orbit_security_label_title',
        style: TextInputStyle.Short,
        required: true,
        maxLength: 256,
      },
      {
        id: 'security_description',
        labelKey: 'orbit_security_label_description',
        style: TextInputStyle.Paragraph,
        required: true,
        maxLength: 1000,
      },
      {
        id: 'security_severity',
        labelKey: 'orbit_security_label_severity',
        style: TextInputStyle.Short,
        required: true,
        maxLength: 20,
      },
    ],
  },
  abuse: {
    titleKey: 'orbit_abuse_modal_title',
    fields: [
      {
        id: 'abuse_type',
        labelKey: 'orbit_abuse_label_type',
        style: TextInputStyle.Short,
        required: true,
        maxLength: 50,
      },
      {
        id: 'abuse_reported_user',
        labelKey: 'orbit_abuse_label_reported_user',
        style: TextInputStyle.Short,
        required: true,
        maxLength: 100,
      },
      {
        id: 'abuse_description',
        labelKey: 'orbit_abuse_label_description',
        style: TextInputStyle.Paragraph,
        required: true,
        maxLength: 1000,
      },
      {
        id: 'abuse_evidence',
        labelKey: 'orbit_abuse_label_evidence',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1000,
      },
    ],
  },
};

async function showModal(interaction: ChatInputCommandInteraction, type: string): Promise<void> {
  const definition = MODALS[type];
  if (!definition) return;

  const guildSettings = await getGuildSettings(interaction.guild!.id);
  const lang = guildSettings?.language;

  const modal = new ModalBuilder()
    .setCustomId(`orbit_${type}_modal`)
    .setTitle(t(lang, definition.titleKey));

  modal.addComponents(
    definition.fields.map((field) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(t(lang, field.labelKey))
          .setStyle(field.style)
          .setRequired(field.required)
          .setMaxLength(field.maxLength)
      )
    )
  );

  await interaction.showModal(modal);
}

export default {
  data: new SlashCommandBuilder()
    .setName('orbit')
    .setDescription('Command for the bot')
    .addSubcommand((add) => add.setName('bug').setDescription('Report a bug'))
    .addSubcommand((add) => add.setName('feature').setDescription('Request a new feature'))
    .addSubcommand((add) =>
      add.setName('security').setDescription('Report a security vulnerability')
    )
    .addSubcommand((add) =>
      add.setName('abuse').setDescription('Report bot abuse (spam, misuse, exploitation, etc.)')
    ),

  async execute(interaction) {
    if (!interaction.guild) return;

    const subCommand = interaction.options.getSubcommand(false);
    if (subCommand) await showModal(interaction, subCommand);
  },
} satisfies Command;
