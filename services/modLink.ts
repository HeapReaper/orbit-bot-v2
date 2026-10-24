import {
  AuditLogEvent,
  type GuildBan,
  type GuildMember,
  type PartialGuildMember,
} from 'discord.js';
import { prisma } from '../lib/prisma';
import { Logging } from '../lib/logging';
import { getGuildSettings } from '../lib/guildSettings';
import { t } from '../lib/i18n';

export async function handleBan(ban: GuildBan) {
  const client = ban.client;
  const settings = await prisma.modLinkSettings.findUnique({
    where: { guildId: ban.guild.id },
  });

  if (!settings?.enabled) return;
  if (!settings.actionsToSync.includes('ban')) return;

  for (const targetGuildId of settings.syncedGuilds) {
    try {
      const targetGuild = await client.guilds.fetch(targetGuildId);
      if (!targetGuild.members.me?.permissions.has('BanMembers')) continue;

      // Fetch just this user's ban instead of downloading the guild's entire
      // ban list, which on a large server is thousands of entries per sync.
      const existingBan = await targetGuild.bans.fetch(ban.user.id).catch(() => null);
      if (existingBan) continue;

      await targetGuild.members.ban(ban.user.id, {
        reason: `Synced ban from ${ban.guild.name}`,
      });
    } catch (err) {
      Logging.error(`Failed to sync ban to guild ${targetGuildId}: ${err}`);
    }
  }

  if (settings.channel) {
    const modChannel = await client.channels.fetch(settings.channel).catch(() => null);
    if (!modChannel?.isSendable()) return;

    const guildSettings = await getGuildSettings(ban.guild.id);
    await modChannel.send(
      t(guildSettings?.language, 'modlink_banned', { user: ban.user.tag, guild: ban.guild.name })
    );
  }
}

export async function handleKick(member: GuildMember | PartialGuildMember) {
  const client = member.client;
  const settings = await prisma.modLinkSettings.findUnique({
    where: { guildId: member.guild.id },
  });

  if (!settings?.enabled) return;
  if (!settings.actionsToSync.includes('kick')) return;

  // GuildMemberRemove also fires when somebody simply leaves, or is banned.
  // Syncing on that alone got members who quit one server kicked out of every
  // linked one, so confirm against the audit log that this really was a kick.
  if (!(await wasKicked(member))) return;

  for (const targetGuildId of settings.syncedGuilds) {
    try {
      const targetGuild = await client.guilds.fetch(targetGuildId);
      if (!targetGuild.members.me?.permissions.has('KickMembers')) continue;

      const targetMember = await targetGuild.members.fetch(member.id).catch(() => null);
      if (!targetMember) continue;

      await targetMember.kick(`Synced kick from ${member.guild.name}`);
    } catch (err) {
      Logging.error(`Failed to sync kick to guild ${targetGuildId}: ${err}`);
    }
  }

  if (settings.channel) {
    const modChannel = await client.channels.fetch(settings.channel).catch(() => null);
    if (!modChannel?.isSendable()) return;

    const guildSettings = await getGuildSettings(member.guild.id);
    await modChannel.send(
      t(guildSettings?.language, 'modlink_kicked', {
        user: member.user?.tag || member.id,
        guild: member.guild.name,
      })
    );
  }
}

/**
 * True when the member's departure was a kick performed in the last few
 * seconds, as recorded in the audit log. Returns false when the log cannot be
 * read, so an unreadable log never causes a cross-guild kick.
 */
async function wasKicked(member: GuildMember | PartialGuildMember): Promise<boolean> {
  if (!member.guild.members.me?.permissions.has('ViewAuditLog')) return false;

  try {
    const logs = await member.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberKick,
      limit: 5,
    });

    return logs.entries.some(
      (entry) => entry.target?.id === member.id && Date.now() - entry.createdTimestamp < 10_000
    );
  } catch (error) {
    Logging.warn(`ModLink: could not read audit log for ${member.guild.id}: ${error}`);
    return false;
  }
}

export async function handleMute(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  const client = newMember.client;
  if (
    oldMember.communicationDisabledUntilTimestamp === newMember.communicationDisabledUntilTimestamp
  )
    return;

  if (oldMember.partial) {
    oldMember = await oldMember.fetch();
  }

  const settings = await prisma.modLinkSettings.findUnique({
    where: { guildId: newMember.guild.id },
  });

  if (!settings?.enabled) return;
  if (!settings.actionsToSync.includes('mute')) return;

  const muteUntil = newMember.communicationDisabledUntilTimestamp;
  if (!muteUntil) return;

  for (const targetGuildId of settings.syncedGuilds) {
    try {
      const targetGuild = await client.guilds.fetch(targetGuildId);
      if (!targetGuild.members.me?.permissions.has('ModerateMembers')) continue;

      const targetMember = await targetGuild.members.fetch(newMember.id).catch(() => null);
      if (!targetMember) continue;

      await targetMember.timeout(
        muteUntil - Date.now(),
        `Synced mute from ${newMember.guild.name}`
      );
    } catch (err) {
      Logging.error(`Failed to sync mute to guild ${targetGuildId}: ${err}`);
    }
  }

  if (settings.channel) {
    const modChannel = await client.channels.fetch(settings.channel).catch(() => null);
    if (!modChannel?.isSendable()) return;

    const guildSettings = await getGuildSettings(newMember.guild.id);
    await modChannel.send(
      t(guildSettings?.language, 'modlink_muted', {
        user: newMember.user?.tag || newMember.id,
        guild: newMember.guild.name,
        until: Math.floor(muteUntil / 1000).toString(),
      })
    );
  }
}
