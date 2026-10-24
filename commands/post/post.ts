import {
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Command } from '../../types';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { input, MODAL_PREFIX, type PostType, withPostErrorReply } from '../../services/post';

export default {
  data: new SlashCommandBuilder()
    .setName('post')
    .setDescription('Post a message, embed, or forum topic')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((subcommand) =>
      subcommand.setName('message').setDescription('Post a message in a channel')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('embed').setDescription('Post an embed in a channel')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('forum').setDescription('Create a topic in a forum channel')
    ),

  async execute(interaction) {
    if (!interaction.guild) return;

    await withPostErrorReply(interaction, async () => {
      const guildSettings = await getGuildSettings(interaction.guild!.id);

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
        await interaction.reply({
          content: t(guildSettings.language, 'post_no_permission'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const type = interaction.options.getSubcommand() as PostType;
      const modal = new ModalBuilder()
        .setCustomId(`${MODAL_PREFIX}${type}`)
        .setTitle(
          type === 'message'
            ? t(guildSettings.language, 'post_message_modal_title')
            : type === 'embed'
              ? t(guildSettings.language, 'post_embed_modal_title')
              : t(guildSettings.language, 'post_forum_modal_title')
        );

      if (type === 'message') {
        modal.addComponents(
          input(
            'content',
            t(guildSettings.language, 'post_content_label'),
            TextInputStyle.Paragraph,
            true,
            2000
          ),
          input(
            'image',
            t(guildSettings.language, 'post_image_label'),
            TextInputStyle.Short,
            false,
            2048
          )
        );
      } else if (type === 'embed') {
        modal.addComponents(
          input(
            'title',
            t(guildSettings.language, 'post_embed_title_label'),
            TextInputStyle.Short,
            false,
            256
          ),
          input(
            'description',
            t(guildSettings.language, 'post_embed_description_label'),
            TextInputStyle.Paragraph,
            true,
            4000
          ),
          input(
            'color',
            t(guildSettings.language, 'post_embed_color_label'),
            TextInputStyle.Short,
            false,
            7
          ),
          input(
            'footer',
            t(guildSettings.language, 'post_embed_footer_label'),
            TextInputStyle.Short,
            false,
            2048
          ),
          input(
            'thumbnail',
            t(guildSettings.language, 'post_embed_thumbnail_label'),
            TextInputStyle.Short,
            false,
            2048
          )
        );
      } else {
        modal.addComponents(
          input(
            'title',
            t(guildSettings.language, 'post_forum_title_label'),
            TextInputStyle.Short,
            true,
            100
          ),
          input(
            'content',
            t(guildSettings.language, 'post_content_label'),
            TextInputStyle.Paragraph,
            true,
            2000
          )
        );
      }

      await interaction.showModal(modal);
    });
  },
} satisfies Command;
