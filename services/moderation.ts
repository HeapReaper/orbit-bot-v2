import {
  ColorResolvable,
  EmbedBuilder,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import type { ModerationFilter, ModerationSettings } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/redis';
import { Logging } from '../lib/logging';
import { t } from '../lib/i18n';
import { getGuildSettings } from '../lib/guildSettings';

const redis = getRedisClient();

/** Short TTL: a dashboard save has to take effect without restarting the bot. */
const SETTINGS_CACHE_TTL = 60;

/** Discord refuses timeouts longer than 28 days. */
const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

export type ModerationActionName =
  'none' | 'warn' | 'mute' | 'timeout' | 'kick' | 'softban' | 'ban';

export interface ModerationEscalation {
  warnings: number;
  action: ModerationActionName;
  duration: number;
}

export type ModerationConfig = ModerationSettings & { filters: ModerationFilter[] };

export interface ApplyActionOptions {
  member: GuildMember;
  action: ModerationActionName;
  reason: string;
  config: ModerationConfig;
  /** Minutes, 0 means permanent. */
  duration?: number;
  /** Absent for automatic actions taken by a filter. */
  moderatorId?: string;
  /** Which filter caused this, used for the log embed. */
  filterType?: string;
  /** Set while running an escalation so a step cannot escalate again. */
  fromEscalation?: boolean;
}

const settingsCacheKey = (guildId: string) => `moderation:settings:${guildId}`;

/** Loads settings plus filters, cached in Redis. */
export async function getModerationConfig(guildId: string): Promise<ModerationConfig | null> {
  try {
    const cached = await redis.get(settingsCacheKey(guildId));
    if (cached) return JSON.parse(cached) as ModerationConfig;
  } catch (error) {
    Logging.warn(`[Moderation] Could not read settings cache for ${guildId}: ${error}`);
  }

  const settings = await prisma.moderationSettings.findUnique({
    where: { guildId },
    include: { filters: true },
  });

  if (!settings) return null;

  await redis
    .set(settingsCacheKey(guildId), JSON.stringify(settings), 'EX', SETTINGS_CACHE_TTL)
    .catch((error) => Logging.warn(`[Moderation] Could not cache settings: ${error}`));

  return settings;
}

/** Drops the cached settings, used after the bot changes them itself. */
export async function clearModerationConfig(guildId: string): Promise<void> {
  await redis.del(settingsCacheKey(guildId)).catch(() => null);
}

export function getEscalations(config: ModerationConfig): ModerationEscalation[] {
  if (!Array.isArray(config.escalations)) return [];

  return (config.escalations as unknown as ModerationEscalation[])
    .filter((step) => step && typeof step.warnings === 'number' && step.action !== 'none')
    .sort((a, b) => a.warnings - b.warnings);
}

/**
 * Server wide exemptions: administrators, immune roles and ignored channels.
 *
 * @param channelId Absent for the member filters, which run on a join or a
 *   name change and therefore have no channel to check.
 */
export function isImmune(
  member: GuildMember,
  config: ModerationConfig,
  channelId?: string
): boolean {
  if (channelId && config.ignoredChannels.includes(channelId)) return true;
  if (config.ignoreAdmins && member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (config.immuneRoles.some((roleId) => member.roles.cache.has(roleId))) return true;

  // Never act on someone the bot cannot act on anyway
  return member.id === member.guild.ownerId;
}

/** Exemptions configured on the filter itself, on top of the server wide ones. */
export function isFilterIgnored(
  filter: ModerationFilter,
  member: GuildMember,
  channelId?: string
): boolean {
  if (channelId && filter.ignoredChannels.includes(channelId)) return true;
  return filter.ignoredRoles.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * A mute needs a role to hand out. Without one Discord's own timeout is the
 * closest equivalent, so the punishment still lands instead of silently doing
 * nothing. The caller is told about the swap so it can be logged.
 */
function resolveAction(
  member: GuildMember,
  action: ModerationActionName,
  config: ModerationConfig
): { action: ModerationActionName; fellBack: boolean } {
  if (action !== 'mute') return { action, fellBack: false };

  const role = config.muteRole ? member.guild.roles.cache.get(config.muteRole) : undefined;
  if (role) return { action: 'mute', fellBack: false };

  return { action: 'timeout', fellBack: true };
}

/** A timeout cannot be permanent, so "forever" becomes Discord's maximum. */
function resolveDuration(action: ModerationActionName, minutes: number): number {
  if (action !== 'timeout') return minutes;
  if (minutes <= 0) return MAX_TIMEOUT_MINUTES;

  return Math.min(minutes, MAX_TIMEOUT_MINUTES);
}

function describeDuration(lang: string, minutes: number): string {
  if (!minutes || minutes <= 0) return t(lang, 'moderation_permanent');
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

async function sendDirectMessage(
  member: GuildMember,
  action: ModerationActionName,
  reason: string,
  duration: number,
  config: ModerationConfig,
  lang: string
): Promise<void> {
  if (!config.dmOnPunishment) return;

  const replacements: Record<string, string> = {
    user: member.user.username,
    server: member.guild.name,
    action: t(lang, `moderation_action_${action}`),
    reason,
    duration: describeDuration(lang, duration),
  };

  let content = config.dmMessage?.trim() || t(lang, 'moderation_dm_default');
  for (const [name, value] of Object.entries(replacements)) {
    content = content.split(`{${name}}`).join(value);
  }

  // A closed DM is normal, never let it block the punishment itself
  await member.send({ content }).catch(() => null);
}

async function sendLogEmbed(
  guild: Guild,
  config: ModerationConfig,
  fields: { name: string; value: string }[],
  title: string
): Promise<void> {
  if (!config.logChannel) return;

  const channel = guild.channels.cache.get(config.logChannel) as TextChannel | undefined;
  if (!channel?.isTextBased()) return;

  const guildSettings = await getGuildSettings(guild.id);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor((guildSettings?.primaryColor ?? '#2F3136') as ColorResolvable)
    .addFields(fields)
    .setTimestamp(new Date());

  await channel
    .send({ embeds: [embed] })
    .catch((error) => Logging.error(`[Moderation] Could not send log message: ${error}`));
}

/** Logs a filter hit that did not (yet) lead to a punishment. */
export async function logFilterHit(
  member: GuildMember,
  filter: ModerationFilter,
  channelId: string | null,
  config: ModerationConfig,
  content: string
): Promise<void> {
  if (!filter.log) return;

  const guildSettings = await getGuildSettings(member.guild.id);
  const lang = guildSettings?.language ?? 'en';

  const fields = [
    { name: t(lang, 'moderation_member'), value: `<@${member.id}>` },
    { name: t(lang, 'moderation_filter'), value: t(lang, `moderation_filter_${filter.type}`) },
  ];

  // The member filters run on a join or a name change, without a channel
  if (channelId) {
    fields.push({ name: t(lang, 'moderation_channel'), value: `<#${channelId}>` });
  }

  if (content.trim()) {
    fields.push({
      name: t(lang, 'moderation_message'),
      value: content.slice(0, 1000),
    });
  }

  await sendLogEmbed(member.guild, config, fields, t(lang, 'moderation_filter_triggered'));
}

/**
 * Applies a punishment, stores the case and reports it.
 *
 * The member is messaged before the action runs, because a kicked or banned
 * member can no longer be reached over DM afterwards.
 */
export async function applyAction(options: ApplyActionOptions): Promise<boolean> {
  const { member, action, reason, config, moderatorId, filterType, fromEscalation } = options;
  if (action === 'none') return false;

  const guildSettings = await getGuildSettings(member.guild.id);
  const lang = guildSettings?.language ?? 'en';
  const requested = Math.max(0, options.duration ?? 0);

  // What actually happens can differ from what was configured: a mute without
  // a mute role becomes a timeout, and a timeout cannot last forever.
  const { action: effectiveAction, fellBack } = resolveAction(member, action, config);
  const duration = resolveDuration(effectiveAction, requested);

  if (fellBack) {
    Logging.debug(
      `[Moderation] No mute role in ${member.guild.id}, using a Discord timeout instead`
    );
  }

  await sendDirectMessage(member, effectiveAction, reason, duration, config, lang);

  const executed = await executeAction(member, effectiveAction, reason, duration, config);
  if (!executed) {
    Logging.warn(
      `[Moderation] Could not apply "${effectiveAction}" to ${member.id} in ${member.guild.id}, missing permissions?`
    );
    return false;
  }

  const expiresAt = calculateExpiry(effectiveAction, duration, config);

  await prisma.moderationCase
    .create({
      data: {
        guildId: member.guild.id,
        userId: member.id,
        moderatorId: moderatorId ?? null,
        action: effectiveAction,
        reason,
        filterType: filterType ?? null,
        duration,
        expiresAt,
        // Only warnings and temporary punishments have to be expired later
        active:
          effectiveAction === 'warn' || effectiveAction === 'mute' || effectiveAction === 'timeout',
      },
    })
    .catch((error) => Logging.error(`[Moderation] Could not store case: ${error}`));

  const fields = [
    { name: t(lang, 'moderation_member'), value: `<@${member.id}>` },
    {
      name: t(lang, 'moderation_action'),
      value: t(lang, `moderation_action_${effectiveAction}`),
    },
    { name: t(lang, 'reason'), value: reason.slice(0, 1000) },
    {
      name: t(lang, 'moderation_moderator'),
      value: moderatorId ? `<@${moderatorId}>` : t(lang, 'moderation_automatic'),
    },
  ];

  if (effectiveAction === 'mute' || effectiveAction === 'timeout') {
    fields.push({
      name: t(lang, 'moderation_duration'),
      value: describeDuration(lang, duration),
    });
  }

  if (fellBack) {
    fields.push({
      name: t(lang, 'moderation_note'),
      value: t(lang, 'moderation_mute_fallback'),
    });
  }

  if (filterType) {
    fields.push({
      name: t(lang, 'moderation_filter'),
      value: t(lang, `moderation_filter_${filterType}`),
    });
  }

  await sendLogEmbed(member.guild, config, fields, t(lang, 'moderation_action_taken'));

  if (action === 'warn' && !fromEscalation) {
    await runEscalation(member, config, moderatorId);
  }

  return true;
}

function calculateExpiry(
  action: ModerationActionName,
  duration: number,
  config: ModerationConfig
): Date | null {
  if (action === 'warn') {
    if (config.warnExpiryDays <= 0) return null;
    return new Date(Date.now() + config.warnExpiryDays * 86_400_000);
  }

  if (action === 'mute' || action === 'timeout') {
    if (duration <= 0) return null;
    return new Date(Date.now() + duration * 60_000);
  }

  return null;
}

/**
 * Removes the welcome message of a member that is being kicked or banned, so a
 * "welcome @spambot" line does not stay behind after the account is gone. Only
 * runs when the welcome module is set to clean up its own messages.
 */
async function clearWelcomeMessage(member: GuildMember): Promise<void> {
  const welcomeSettings = await prisma.welcomeMessageSettings
    .findFirst({ where: { guildId: member.guild.id } })
    .catch(() => null);

  if (!welcomeSettings?.deleteMessage) return;

  const sent = await prisma.welcomeMessagesSended
    .findFirst({ where: { guildId: member.guild.id, userId: member.id } })
    .catch(() => null);

  if (!sent) return;

  try {
    const channel = await member.client.channels.fetch(sent.channelId);
    if (channel?.isTextBased()) {
      const message = await channel.messages.fetch(sent.messageId).catch(() => null);
      await message?.delete().catch(() => null);
    }

    await prisma.welcomeMessagesSended.delete({ where: { id: sent.id } });
  } catch (error) {
    Logging.warn(`[Moderation] Could not clear welcome message for ${member.id}: ${error}`);
  }
}

async function executeAction(
  member: GuildMember,
  action: ModerationActionName,
  reason: string,
  duration: number,
  config: ModerationConfig
): Promise<boolean> {
  const deleteMessageSeconds = Math.min(7, Math.max(0, config.deleteMessageDays)) * 86_400;

  try {
    switch (action) {
      case 'warn':
        // Nothing to do on Discord, the case row is the warning
        return true;

      case 'mute': {
        // resolveAction already sent a role-less mute down the timeout path
        const role = config.muteRole ? member.guild.roles.cache.get(config.muteRole) : undefined;
        if (!role || !member.manageable) return false;

        await member.roles.add(role, reason);
        return true;
      }

      case 'timeout': {
        if (!member.moderatable) return false;

        // Already clamped by resolveDuration
        await member.timeout(duration * 60_000, reason);
        return true;
      }

      case 'kick':
        if (!member.kickable) return false;
        await member.kick(reason);
        await clearWelcomeMessage(member);
        return true;

      case 'softban': {
        if (!member.bannable) return false;

        // Ban and immediately unban, which clears the recent messages but
        // still lets the member rejoin with a new invite.
        await member.ban({ reason, deleteMessageSeconds });
        await member.guild.bans.remove(member.id, reason);
        await clearWelcomeMessage(member);
        return true;
      }

      case 'ban':
        if (!member.bannable) return false;
        await member.ban({ reason, deleteMessageSeconds });
        await clearWelcomeMessage(member);
        return true;

      default:
        return false;
    }
  } catch (error) {
    Logging.error(`[Moderation] Failed to ${action} ${member.id}: ${error}`);
    return false;
  }
}

/** Counts the warnings that have not expired yet. */
export async function countActiveWarnings(guildId: string, userId: string): Promise<number> {
  return prisma.moderationCase.count({
    where: {
      guildId,
      userId,
      action: 'warn',
      active: true,
    },
  });
}

/**
 * Runs the configured warning ladder. Only the highest step the member reached
 * is applied, so passing several thresholds at once does not stack punishments.
 */
async function runEscalation(
  member: GuildMember,
  config: ModerationConfig,
  moderatorId?: string
): Promise<void> {
  const escalations = getEscalations(config);
  if (escalations.length === 0) return;

  const warnings = await countActiveWarnings(member.guild.id, member.id);

  const step = escalations.filter((item) => warnings >= item.warnings).pop();
  if (!step) return;

  const guildSettings = await getGuildSettings(member.guild.id);
  const lang = guildSettings?.language ?? 'en';

  await applyAction({
    member,
    action: step.action,
    reason: t(lang, 'moderation_escalation_reason', { warnings: String(warnings) }),
    config,
    duration: step.duration || config.defaultMuteDuration,
    moderatorId,
    fromEscalation: true,
  });
}
