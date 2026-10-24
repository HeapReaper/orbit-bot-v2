import { ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType, MessageFlags } from 'discord.js';
import type { Component } from '../../types';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import {
  isHttpUrl,
  MODAL_PREFIX,
  type PendingPost,
  PENDING_POST_TTL,
  pendingPosts,
  prunePendingPosts,
  type PostType,
  SELECT_PREFIX,
  withPostErrorReply,
} from '../../services/post';

/** Submit of the /post form: stores the post and asks for the target channel. */
export default {
  customId: /^post_modal:/,

  async execute(interaction) {
    if (!interaction.isModalSubmit() || !interaction.guild) return;

    await withPostErrorReply(interaction, async () => {
      const guildSettings = await getGuildSettings(interaction.guild!.id);
      const type = interaction.customId.slice(MODAL_PREFIX.length) as PostType;
      if (!['message', 'embed', 'forum'].includes(type)) return;

      const token = `${interaction.user.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const pending: PendingPost = {
        type,
        userId: interaction.user.id,
        expiresAt: Date.now() + PENDING_POST_TTL,
      };
      if (type === 'message' || type === 'forum')
        pending.content = interaction.fields.getTextInputValue('content').trim();
      if (type === 'message')
        pending.imageUrl = interaction.fields.getTextInputValue('image').trim();
      if (type === 'forum') pending.title = interaction.fields.getTextInputValue('title').trim();
      if (type === 'embed') {
        pending.title = interaction.fields.getTextInputValue('title').trim();
        pending.description = interaction.fields.getTextInputValue('description').trim();
        pending.color = interaction.fields.getTextInputValue('color').trim();
        pending.footer = interaction.fields.getTextInputValue('footer').trim();
        pending.thumbnailUrl = interaction.fields.getTextInputValue('thumbnail').trim();
        if (pending.color && !/^#?[0-9a-f]{6}$/i.test(pending.color)) {
          await interaction.reply({
            content: t(guildSettings.language, 'post_invalid_color'),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (pending.thumbnailUrl && !isHttpUrl(pending.thumbnailUrl)) {
          await interaction.reply({
            content: t(guildSettings.language, 'post_invalid_url'),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }
      if (pending.imageUrl && !isHttpUrl(pending.imageUrl)) {
        await interaction.reply({
          content: t(guildSettings.language, 'post_invalid_image_url'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      prunePendingPosts();
      pendingPosts.set(token, pending);

      const channelTypes =
        type === 'forum'
          ? [ChannelType.GuildForum]
          : [ChannelType.GuildText, ChannelType.GuildAnnouncement];
      const select = new ChannelSelectMenuBuilder()
        .setCustomId(`${SELECT_PREFIX}${token}`)
        .setPlaceholder(
          type === 'forum'
            ? t(guildSettings.language, 'post_select_forum_placeholder')
            : t(guildSettings.language, 'post_select_channel_placeholder')
        )
        .setChannelTypes(...channelTypes);
      await interaction.reply({
        content:
          type === 'forum'
            ? t(guildSettings.language, 'post_select_forum')
            : t(guildSettings.language, 'post_select_channel'),
        components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
    });
  },
} satisfies Component;
