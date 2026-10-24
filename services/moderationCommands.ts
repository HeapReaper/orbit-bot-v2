import { type ChatInputCommandInteraction, type GuildMember, MessageFlags } from 'discord.js';
import { prisma } from '../lib/prisma';
import { Logging } from '../lib/logging';
import { t } from '../lib/i18n';
import { getGuildSettings } from '../lib/guildSettings';
import { applyAction, getModerationConfig, type ModerationConfig } from './moderation';

type Handler = (
  interaction: ChatInputCommandInteraction,
  config: ModerationConfig,
  lang: string
) => Promise<void>;

/**
 * Shared gate for every moderation command: checks the permission on top of
 * Discord's own command permissions, refuses when the module is disabled and
 * defers the reply before the handler runs.
 */
export async function runModerationCommand(
  interaction: ChatInputCommandInteraction,
  requiredPermission: bigint,
  handler: Handler
): Promise<void> {
  if (!interaction.guild) return;

  const guildSettings = await getGuildSettings(interaction.guild.id);
  const lang = guildSettings?.language ?? 'en';

  const moderator = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!moderator?.permissions.has(requiredPermission)) {
    await interaction.reply({
      content: t(lang, 'moderation_no_permission'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const config = await getModerationConfig(interaction.guild.id);
  if (!config?.enabled) {
    await interaction.reply({
      content: t(lang, 'moderation_disabled'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await handler(interaction, config, lang);
}

/** Shared path for warn, mute, kick and ban. */
export const handlePunishment: Handler = async (interaction, config, lang) => {
  const target = await resolveTarget(interaction, lang);
  if (!target) return;

  const action = interaction.commandName as 'warn' | 'mute' | 'kick' | 'ban';
  const reason = interaction.options.getString('reason') ?? t(lang, 'moderation_no_reason');
  const minutes = interaction.options.getInteger('minutes');

  const duration = action === 'mute' ? (minutes ?? config.defaultMuteDuration) : 0;

  const applied = await applyAction({
    member: target,
    action,
    reason,
    config,
    duration,
    moderatorId: interaction.user.id,
  });

  await interaction.editReply({
    content: applied
      ? t(lang, 'moderation_command_done', {
          action: t(lang, `moderation_action_${action}`),
          user: `<@${target.id}>`,
        })
      : t(lang, 'moderation_command_failed'),
  });
};

export const handleWarnings: Handler = async (interaction, _config, lang) => {
  const user = interaction.options.getUser('member', true);

  const warnings = await prisma.moderationCase.findMany({
    where: {
      guildId: interaction.guild!.id,
      userId: user.id,
      action: 'warn',
      active: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });

  if (warnings.length === 0) {
    await interaction.editReply({
      content: t(lang, 'moderation_no_warnings', { user: `<@${user.id}>` }),
    });
    return;
  }

  const lines = warnings.map((warning) => {
    const date = warning.createdAt.toISOString().slice(0, 10);
    const moderator = warning.moderatorId
      ? `<@${warning.moderatorId}>`
      : t(lang, 'moderation_automatic');

    return `\`#${warning.id}\` ${date} — ${warning.reason} (${moderator})`;
  });

  await interaction.editReply({
    content: `${t(lang, 'moderation_warnings_for', {
      user: `<@${user.id}>`,
      count: String(warnings.length),
    })}\n${lines.join('\n')}`,
  });
};

export const handleDeleteWarning: Handler = async (interaction, _config, lang) => {
  const caseId = interaction.options.getInteger('case', true);

  // Scoped to this guild so a case number from another server cannot be removed
  const removed = await prisma.moderationCase.updateMany({
    where: {
      id: caseId,
      guildId: interaction.guild!.id,
      action: 'warn',
      active: true,
    },
    data: { active: false },
  });

  await interaction.editReply({
    content:
      removed.count > 0
        ? t(lang, 'moderation_warning_removed', { case: String(caseId) })
        : t(lang, 'moderation_warning_not_found', { case: String(caseId) }),
  });
};

export const handleUnmute: Handler = async (interaction, config, lang) => {
  const target = await resolveTarget(interaction, lang);
  if (!target) return;

  if (config.muteRole && target.roles.cache.has(config.muteRole)) {
    await target.roles
      .remove(config.muteRole, t(lang, 'moderation_unmuted_by_moderator'))
      .catch((error) => Logging.error(`[Moderation] Could not remove mute role: ${error}`));
  }

  if (target.isCommunicationDisabled()) {
    await target
      .timeout(null, t(lang, 'moderation_unmuted_by_moderator'))
      .catch((error) => Logging.error(`[Moderation] Could not lift timeout: ${error}`));
  }

  await prisma.moderationCase.updateMany({
    where: {
      guildId: interaction.guild!.id,
      userId: target.id,
      action: { in: ['mute', 'timeout'] },
      active: true,
    },
    data: { active: false },
  });

  await interaction.editReply({
    content: t(lang, 'moderation_command_done', {
      action: t(lang, 'moderation_action_unmute'),
      user: `<@${target.id}>`,
    }),
  });
};

export const handleUnban: Handler = async (interaction, _config, lang) => {
  const userId = interaction.options.getString('user_id', true).trim();
  const reason = interaction.options.getString('reason') ?? t(lang, 'moderation_no_reason');

  try {
    await interaction.guild!.bans.remove(userId, reason);
  } catch {
    await interaction.editReply({ content: t(lang, 'moderation_not_banned') });
    return;
  }

  await interaction.editReply({
    content: t(lang, 'moderation_command_done', {
      action: t(lang, 'moderation_action_unban'),
      user: `<@${userId}>`,
    }),
  });
};

/**
 * Resolves the target member and refuses the ones a moderator may not touch:
 * themselves, the bot, and anyone at or above their own role.
 */
async function resolveTarget(
  interaction: ChatInputCommandInteraction,
  lang: string
): Promise<GuildMember | null> {
  const user = interaction.options.getUser('member', true);
  const target = await interaction.guild!.members.fetch(user.id).catch(() => null);

  if (!target) {
    await interaction.editReply({ content: t(lang, 'moderation_member_not_found') });
    return null;
  }

  if (target.id === interaction.user.id) {
    await interaction.editReply({ content: t(lang, 'moderation_cannot_target_self') });
    return null;
  }

  if (target.id === interaction.client.user.id) {
    await interaction.editReply({ content: t(lang, 'moderation_cannot_target_bot') });
    return null;
  }

  const moderator = await interaction.guild!.members.fetch(interaction.user.id);
  const isOwner = interaction.guild!.ownerId === moderator.id;

  if (!isOwner && target.roles.highest.position >= moderator.roles.highest.position) {
    await interaction.editReply({ content: t(lang, 'moderation_target_too_high') });
    return null;
  }

  return target;
}
