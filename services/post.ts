import { ActionRowBuilder, MessageFlags, TextInputBuilder, type TextInputStyle } from 'discord.js';
import type { Interaction } from 'discord.js';
import { Logging } from '../lib/logging';
import { getGuildSettings } from '../lib/guildSettings';
import { t } from '../lib/i18n';

export type PostType = 'message' | 'embed' | 'forum';

export interface PendingPost {
  type: PostType;
  userId: string;
  content?: string;
  title?: string;
  description?: string;
  color?: string;
  footer?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  expiresAt: number;
}

export const pendingPosts = new Map<string, PendingPost>();
export const MODAL_PREFIX = 'post_modal:';
export const SELECT_PREFIX = 'post_channel:';
export const PENDING_POST_TTL = 10 * 60 * 1000;

/**
 * A post is only removed when its channel is picked, so every dismissed
 * channel picker left its entry behind in v1. Expired entries are dropped
 * whenever a new one is stored.
 */
export function prunePendingPosts(): void {
  const now = Date.now();
  for (const [token, post] of pendingPosts) {
    if (post.expiresAt < now) pendingPosts.delete(token);
  }
}

export function input(
  id: string,
  label: string,
  style: TextInputStyle,
  required: boolean,
  maxLength: number
) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setRequired(required)
      .setMaxLength(maxLength)
  );
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Runs a /post step and answers with the translated error when it throws. */
export async function withPostErrorReply(
  interaction: Interaction,
  run: () => Promise<unknown>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    Logging.error(`Post interaction failed: ${error}`);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      const guildSettings = interaction.guildId
        ? await getGuildSettings(interaction.guildId).catch(() => null)
        : null;
      await interaction
        .reply({
          content: t(guildSettings?.language, 'post_error'),
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);
    }
  }
}
