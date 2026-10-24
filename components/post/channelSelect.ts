import { ChannelType, EmbedBuilder } from 'discord.js';
import type { Component } from '../../types';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { pendingPosts, SELECT_PREFIX, withPostErrorReply } from '../../services/post';

/** Channel picked for a pending /post: sends it there. */
export default {
  customId: /^post_channel:/,

  async execute(interaction) {
    if (!interaction.isChannelSelectMenu() || !interaction.guild) return;

    await withPostErrorReply(interaction, async () => {
      const guildSettings = await getGuildSettings(interaction.guild!.id);
      const token = interaction.customId.slice(SELECT_PREFIX.length);
      const pending = pendingPosts.get(token);
      pendingPosts.delete(token);
      if (!pending || pending.userId !== interaction.user.id || pending.expiresAt < Date.now()) {
        await interaction.update({
          content: t(guildSettings.language, 'post_session_expired'),
          components: [],
        });
        return;
      }

      const channel = await interaction
        .guild!.channels.fetch(interaction.values[0]!)
        .catch(() => null);
      if (
        !channel ||
        (pending.type === 'forum'
          ? channel.type !== ChannelType.GuildForum
          : ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
      ) {
        await interaction.update({
          content: t(guildSettings.language, 'post_invalid_channel'),
          components: [],
        });
        return;
      }

      if (pending.type === 'forum' && channel.type === ChannelType.GuildForum) {
        await channel.threads.create({
          name: pending.title!,
          message: { content: pending.content! },
        });
      } else if (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement
      ) {
        if (pending.type === 'message') {
          await channel.send({
            content: pending.content!,
            ...(pending.imageUrl
              ? { embeds: [new EmbedBuilder().setImage(pending.imageUrl)] }
              : {}),
          });
        } else {
          const embed = new EmbedBuilder()
            .setDescription(pending.description!)
            .setColor(
              pending.color ? (`#${pending.color.replace(/^#/, '')}` as `#${string}`) : '#5865F2'
            );
          if (pending.title) embed.setTitle(pending.title);
          if (pending.footer) embed.setFooter({ text: pending.footer });
          if (pending.thumbnailUrl) embed.setThumbnail(pending.thumbnailUrl);
          await channel.send({ embeds: [embed] });
        }
      }
      await interaction.update({
        content: t(guildSettings.language, 'post_success', { channel: `<#${channel.id}>` }),
        components: [],
      });
    });
  },
} satisfies Component;
