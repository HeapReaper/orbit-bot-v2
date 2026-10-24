import {
  Client,
  Message,
  GuildMember,
  PartialGuildMember,
  PartialMessage,
  GuildBan,
  EmbedBuilder,
  TextChannel,
  Colors,
  Role,
  GuildChannel,
  ThreadChannel,
  VoiceState,
  GuildScheduledEvent,
  Interaction,
  AuditLogEvent,
  GuildAuditLogsEntry,
  Guild,
} from 'discord.js';
import { getRedisClient } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { getGuildSettings } from '../lib/guildSettings';
import { t } from '../lib/i18n';
import { Logging } from '../lib/logging';

const redis = getRedisClient();

function formatAuditLogAction(action: number, lang?: string | null): string {
  const actionKeys = Object.keys(AuditLogEvent) as (keyof typeof AuditLogEvent)[];
  const matchedKey = actionKeys.find((key) => AuditLogEvent[key] === action);

  if (!matchedKey) return t(lang, 'guildlogger_unknown_action', { action: action.toString() });

  return matchedKey.replace(/([A-Z])/g, ' $1').trim();
}

// Helpers
async function persistGuildLog(guildId: string, type: string, message: string) {
  try {
    await prisma.guildLog.create({
      data: {
        guildId,
        type,
        message,
      },
    });
  } catch (err) {
    console.error(`Failed to persist log for guild ${guildId}:`, err);
  }
}

async function getGuildLanguage(guildId: string) {
  const guildSettings = await getGuildSettings(guildId);
  return guildSettings?.language || 'en'; // Default english if no language was found
}

async function isEventEnabled(guildId: string, eventKey: string) {
  const cacheKey = `logging:${guildId}`;
  const cached = await redis.get(cacheKey);
  let data: any;
  if (cached) {
    try {
      data = JSON.parse(cached);
      return data.enabled && Array.isArray(data.events) && data.events.includes(eventKey);
    } catch {
      await redis.del(cacheKey);
    }
  }
  const settings = await prisma.loggingSettings.findUnique({ where: { guildId } });
  if (!settings || !settings.enabled) {
    await redis.set(cacheKey, JSON.stringify({ enabled: false }), 'EX', 300);
    return false;
  }
  data = { enabled: settings.enabled, channel: settings.channel, events: settings.events || [] };
  await redis.set(cacheKey, JSON.stringify(data), 'EX', 300);
  return data.enabled && Array.isArray(data.events) && data.events.includes(eventKey);
}

async function sendLogEmbed(guild: Guild, embed: EmbedBuilder) {
  const guildId = guild.id;
  const cacheKey = `logging:${guildId}`;
  let settings: any;
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      settings = JSON.parse(cached);
    } catch {
      await redis.del(cacheKey);
    }
  }
  if (!settings) {
    settings = await prisma.loggingSettings.findUnique({ where: { guildId } });
    if (!settings) return;
    await redis.set(cacheKey, JSON.stringify(settings), 'EX', 300);
  }
  if (!settings.channel) return;
  const logChannel = guild.channels.cache.get(settings.channel);
  if (!logChannel || !logChannel.isTextBased()) return;

  // Dont log if it's debug
  if (process.env.ENVIRONMENT === 'debug') return;

  await (logChannel as TextChannel).send({ embeds: [embed] });
}

async function logIfEnabled(guild: Guild | null, eventKey: string, embed: EmbedBuilder) {
  if (!guild) return;
  if (!(await isEventEnabled(guild.id, eventKey))) return;
  await sendLogEmbed(guild, embed);
}

// TODO: Add checkbox to Orbit dashboard and check here
export async function onAuditLogEntryCreate(auditLogEntry: GuildAuditLogsEntry, guild: Guild) {
  const lang = await getGuildLanguage(guild.id);

  const { action, executorId, targetId, reason, changes } = auditLogEntry;

  const executorTag = executorId ? `<@${executorId}>` : t(lang, 'unknown');
  const targetTag = targetId ? `<@${targetId}>` : t(lang, 'none');

  const actionName = formatAuditLogAction(action, lang);

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle(t(lang, 'guildlogger_audit_log_title', { action: actionName }))
    .addFields(
      { name: t(lang, 'executed_by'), value: executorTag, inline: true },
      { name: t(lang, 'target'), value: targetTag, inline: true }
    )
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: t(lang, 'reason'), value: reason });
  }

  if (changes && changes.length > 0) {
    const changeDetails = changes
      .map(
        (change) => `**${change.key}**: \`${change.old ?? 'none'}\` ➔ \`${change.new ?? 'none'}\``
      )
      .join('\n');

    embed.addFields({
      name: t(lang, 'changes'),
      value: changeDetails.substring(0, 1000),
    });
  }

  await addToGuildLog(
    guild.id,
    'INFO',
    `Audit Log [${actionName}] triggered by ${executorId} on target ${targetId}` // TODO: Add translations
  );

  await logIfEnabled(guild, 'audit_log', embed);
}

// Messages
export async function messageDelete(message: Message | PartialMessage) {
  if (message.partial) {
    try {
      message = await message.fetch();
    } catch (err) {
      Logging.error(`Failed to fetch partial message: ${err}`);
      return;
    }
  }

  if (!message.guild) return;

  const lang = await getGuildLanguage(message.guild.id);
  const authorTag = message.author ? `<@${message.author.id}>` : t(lang, 'unknown');
  const authorName = message.author?.username ?? 'Unknown';

  let executorTag: string | null = null;
  let executorName: string | null = null;

  if (message.guild.members.me?.permissions.has('ViewAuditLog')) {
    try {
      const fetchedLogs = await message.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MessageDelete,
      });

      const deleteLog = fetchedLogs.entries.first();

      if (
        deleteLog &&
        deleteLog.target?.id === message.author?.id &&
        deleteLog.extra?.channel?.id === message.channel.id &&
        Date.now() - deleteLog.createdTimestamp < 5000
      ) {
        // Als de executor de auteur zelf is, negeren we de executor (was een handmatige actie van de auteur)
        if (deleteLog.executor?.id !== message.author?.id) {
          executorTag = `<@${deleteLog.executor?.id}>`;
          executorName =
            deleteLog.executor?.displayName ?? deleteLog.executor?.username ?? 'Unknown';
        }
      }
    } catch (error) {
      Logging.error(`Failed to fetch audit log for deleted message: ${error}`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle(t(lang, 'message_deleted'))
    .addFields(
      { name: t(lang, 'author'), value: authorTag },
      { name: t(lang, 'channel'), value: `<#${message.channel.id}>` },
      {
        name: t(lang, 'message'),
        value:
          message.content && message.content.length > 0
            ? message.content.substring(0, 1000)
            : t(lang, 'none'),
      }
    )
    .setTimestamp();

  if (executorTag) {
    embed.addFields({ name: t(lang, 'deleted_by'), value: executorTag });
  }

  // Server/Guild loggin
  const logMessage = executorName
    ? `Message by ${authorName} was deleted by ${executorName} in #${'name' in message.channel ? message.channel.name : message.channel.id}: ${message.content}`
    : `User ${authorName} deleted their own message in #${'name' in message.channel ? message.channel.name : message.channel.id}: ${message.content}`;

  await addToGuildLog(message.guild.id, 'WARN', logMessage);
  await logIfEnabled(message.guild, 'message_delete', embed);
}

export async function messagesBulkDelete(messages: any) {
  const guild = messages.first()?.guild;
  if (!guild) return;

  const lang = await getGuildLanguage(guild.id);

  const embed = new EmbedBuilder()
    .setColor(Colors.DarkRed)
    .setTitle(t(lang, 'messages_deleted'))
    .setDescription(`${t(lang, 'count')}: **${messages.size}**`)
    .setTimestamp();

  // TODO: Add bulk message delete log
  await logIfEnabled(guild, 'message_bulk_delete', embed);
}

export async function messageUpdate(oldMessage: Message | PartialMessage, newMessage: Message) {
  if (!oldMessage.guild || oldMessage.content === newMessage.content) return;

  const lang = await getGuildLanguage(oldMessage.guild.id);

  // Fetch full message if oldMessage is partial
  if (oldMessage.partial) {
    try {
      oldMessage = await oldMessage.fetch();
    } catch (err) {
      console.error('Failed to fetch old message:', err);
      return;
    }
  }

  if (oldMessage.content === newMessage.content) return;

  if (!oldMessage.guild) return;

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'message_edit'))
    .addFields(
      { name: t(lang, 'user'), value: `<@${newMessage.author?.id ?? 'Unknown'}>` },
      {
        name: t(lang, 'old_message'),
        value: oldMessage.content?.substring(0, 1000) ?? t(lang, 'none'),
      },
      {
        name: t(lang, 'new_message'),
        value: newMessage.content?.substring(0, 1000) ?? t(lang, 'none'),
      }
    )
    .setTimestamp();

  await addToGuildLog(
    oldMessage.guild.id,
    'INFO',
    `User ${oldMessage.author.username} updated a message from ${oldMessage.content} to ${newMessage.content}`
  );
  await logIfEnabled(oldMessage.guild, 'message_edit', embed);
}

export async function reactionAdd(reaction: any, user: any) {
  const guildId = reaction.message.guildId;
  if (!guildId) return;

  const lang = await getGuildLanguage(guildId);
  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(t(lang, 'reaction_added'))
    .addFields(
      { name: t(lang, 'user'), value: `<@${user.id ?? 'Unknown'}>` },
      { name: t(lang, 'emoji'), value: `${reaction.emoji ?? t(lang, 'none')}` },
      { name: t(lang, 'message'), value: `${reaction.message.url ?? t(lang, 'none')}` }
    )
    .setTimestamp();

  await addToGuildLog(
    guildId,
    'INFO',
    `User ${user.username} added a reaction: ${reaction.emoji} on message: ${reaction.message.url}`
  );
  await logIfEnabled(reaction.message.guild, 'message_reaction_add', embed);
}

export async function reactionRemove(reaction: any, user: any) {
  const guildId = reaction.message.guildId;
  if (!guildId) return;

  const lang = await getGuildLanguage(guildId);
  const embed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle(t(lang, 'reaction_removed'))
    .addFields(
      { name: t(lang, 'user'), value: `<@${user.id ?? 'Unknown'}>` },
      { name: t(lang, 'emoji'), value: `${reaction.emoji ?? t(lang, 'none')}` },
      { name: t(lang, 'message'), value: `${reaction.message.url ?? t(lang, 'none')}` }
    )
    .setTimestamp();

  await addToGuildLog(
    guildId,
    'WARN',
    `User ${user.username} removed a reaction: ${reaction.emoji} on message: ${reaction.message.url}`
  );
  await logIfEnabled(reaction.message.guild, 'message_reaction_remove', embed);
}

export async function reactionsCleared(message: Message | PartialMessage) {
  if (!message.guild) return;

  const lang = await getGuildLanguage(message.guild.id);

  // Discord does not emit an audit log entry for clearing reactions, so there
  // is nothing to look up here — the previous lookup passed a string that is
  // not a valid AuditLogEvent and always threw into the empty catch.
  const clearedBy = t(lang, 'unknown');

  const embed = new EmbedBuilder()
    .setColor(Colors.DarkGrey)
    .setTitle(t(lang, 'reactions_cleared'))
    .addFields(
      { name: t(lang, 'message'), value: `${message.url ?? t(lang, 'none')}` },
      { name: t(lang, 'cleared_by'), value: clearedBy }
    )
    .setTimestamp();

  // TODO: Add who cleared reactions and log it to guildLog
  await logIfEnabled(message.guild, 'message_reaction_clear', embed);
}

export async function messagePinned(message: Message | PartialMessage) {
  if (!message.guild) return;
  const lang = await getGuildLanguage(message.guild.id);

  let user = `<@${message.author?.id ?? 'Unknown'}>`;
  try {
    const logs = await message.guild.fetchAuditLogs({ type: AuditLogEvent.MessagePin, limit: 1 });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
  } catch (err) {
    console.warn('Failed to fetch audit log for message pin:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle(t(lang, 'message_pin'))
    .addFields(
      { name: t(lang, 'user'), value: user },
      { name: t(lang, 'message'), value: message.content?.substring(0, 1000) ?? t(lang, 'none') }
    )
    .setTimestamp();

  await addToGuildLog(
    message.guild.id,
    'INFO',
    `User ${user} pinned a message: ${message.content?.substring(0, 1000) ?? t(lang, 'none')}`
  );
  await logIfEnabled(message.guild, 'message_pin', embed);
}

export async function messageUnpinned(message: Message | PartialMessage) {
  if (!message.guild) return;
  const lang = await getGuildLanguage(message.guild.id);

  let user = `<@${message.author?.id ?? 'Unknown'}>`;
  try {
    const logs = await message.guild.fetchAuditLogs({
      type: AuditLogEvent.MessageUnpin,
      limit: 1,
    });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
  } catch (err) {
    console.warn('Failed to fetch audit log for message unpin:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle(t(lang, 'message_unpin'))
    .addFields(
      { name: t(lang, 'user'), value: user },
      { name: t(lang, 'message'), value: message.content?.substring(0, 1000) ?? t(lang, 'none') }
    )
    .setTimestamp();

  await addToGuildLog(
    message.guild.id,
    'WARN',
    `User ${user} un-pinned a message: ${message.content?.substring(0, 1000) ?? t(lang, 'none')}`
  );
  await logIfEnabled(message.guild, 'message_unpin', embed);
}

// Member events
export async function memberJoined(member: GuildMember) {
  if (member.partial) {
    try {
      member = await member.fetch();
    } catch (err) {
      Logging.error(`Failed to fetch partial member in GuildLogger Events`);
    }
  }

  await addToGuildLog(member.guild.id, 'INFO', `User ${member.displayName} joined the server`);
}

export async function memberLeft(member: GuildMember | PartialGuildMember) {
  if (!member.guild) return;

  const lang = await getGuildLanguage(member.guild.id);

  if (member.partial) {
    try {
      member = await member.fetch();
    } catch (err) {
      Logging.error(`Failed to fetch partial member in GuildLogger Events`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle(t(lang, 'member_leave'))
    .addFields({ name: t(lang, 'user'), value: `<@${member.id}>` })
    .setTimestamp();

  await addToGuildLog(member.guild.id, 'WARN', `User ${member.displayName} left the server`);
  await logIfEnabled(member.guild, 'member_leave', embed);
}

export async function memberUpdated(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  const lang = await getGuildLanguage(newMember.guild.id);

  // Fetch full member if oldMember is partial
  if (oldMember.partial) {
    try {
      oldMember = await oldMember.fetch();
    } catch (err) {
      console.error('Failed to fetch old member:', err);
      return;
    }
  }

  if (oldMember.displayName === newMember.displayName) return;

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'member_update'))
    .setDescription(`<@${newMember.id}> ${t(lang, 'member_updated')}`)
    .addFields(
      { name: t(lang, 'old_name'), value: `${oldMember.displayName ?? t(lang, 'unknown')}` },
      { name: t(lang, 'new_name'), value: `${newMember.displayName ?? t(lang, 'unknown')}` }
    )
    .setTimestamp();

  await addToGuildLog(
    oldMember.guild.id,
    'INFO',
    `User ${oldMember.displayName} updated there username from ${oldMember.displayName} to ${newMember.displayName}`
  );
  await logIfEnabled(newMember.guild, 'member_update', embed);
}

export async function memberBanned(ban: GuildBan) {
  const lang = await getGuildLanguage(ban.guild.id);

  let executorMention = t(lang, 'unknown');
  let executorName: string | null = null;

  try {
    const logs = await ban.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberBanAdd,
      limit: 1,
    });

    const entry = logs.entries.first();
    if (entry) {
      executorMention = `<@${entry.executor?.id}>`; // Mention in embed
      executorName = entry.executor?.username ?? null; // Plain username for logging
    }
  } catch (err) {
    console.warn('Failed to fetch audit log for member ban:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.DarkRed)
    .setTitle(t(lang, 'member_ban'))
    .addFields(
      { name: t(lang, 'user'), value: `${ban.user.tag}` },
      { name: t(lang, 'done_by'), value: executorMention }
    )
    .setTimestamp();

  await addToGuildLog(
    ban.guild.id,
    'WARN',
    `User ${ban.user?.username ?? 'Unknown'} has been banned${executorName ? ` by ${executorName}` : ''}${ban.reason ? ` (reason: ${ban.reason})` : ''}`
  );

  await logIfEnabled(ban.guild, 'member_ban', embed);
}

export async function memberUnbanned(ban: GuildBan) {
  const lang = await getGuildLanguage(ban.guild.id);

  let executorMention = t(lang, 'unknown');
  let executorName: string | null = null;

  try {
    const logs = await ban.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberBanRemove,
      limit: 1,
    });

    const entry = logs.entries.first();
    if (entry) {
      executorMention = `<@${entry.executor?.id}>`;
      executorName = entry.executor?.username ?? null;
    }
  } catch (err) {
    console.warn('Failed to fetch audit log for member unban:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(t(lang, 'member_unban'))
    .addFields(
      { name: t(lang, 'user'), value: `${ban.user.tag}` },
      { name: t(lang, 'done_by'), value: executorMention }
    )
    .setTimestamp();

  await addToGuildLog(
    ban.guild.id,
    'WARN',
    `User ${ban.user?.username ?? 'Unknown'} has been unbanned${executorName ? ` by ${executorName}` : ''}`
  );

  await logIfEnabled(ban.guild, 'member_unban', embed);

  return { executorMention, executorName };
}

export async function memberTimeout(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  if (!newMember.communicationDisabledUntil) return null;

  const lang = await getGuildLanguage(newMember.guild.id);

  let executorMention = t(lang, 'unknown');
  let executorName: string | null = null;

  try {
    const logs = await newMember.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberUpdate,
      limit: 1,
    });

    const entry = logs.entries.first();
    const changed = entry?.changes?.some((c) => c.key === 'communication_disabled_until');

    if (entry && changed) {
      executorMention = `<@${entry.executor?.id}>`;
      executorName = entry.executor?.username ?? null;
    }
  } catch (err) {
    console.warn('Failed to fetch audit log for timeout:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle(t(lang, 'member_timeout'))
    .addFields(
      { name: t(lang, 'user'), value: `<@${newMember.id}>` },
      {
        name: t(lang, 'until'),
        value: `<t:${Math.floor((newMember.communicationDisabledUntilTimestamp ?? 0) / 1000)}:R>`,
      },
      { name: t(lang, 'done_by'), value: executorMention }
    )
    .setTimestamp();

  await addToGuildLog(
    newMember.guild.id,
    'WARN',
    `User ${newMember.user?.username ?? 'Unknown'} has been timed out${executorName ? ` by ${executorName}` : ''}`
  );

  await logIfEnabled(newMember.guild, 'member_timeout', embed);

  return { executorMention, executorName };
}

export async function memberRoleChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  const lang = await getGuildLanguage(newMember.guild.id);
  const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles?.cache.has(r.id));
  const removedRoles = oldMember.roles?.cache.filter((r) => !newMember.roles.cache.has(r.id)) || [];

  let user = t(lang, 'unknown');
  try {
    const logs = await newMember.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 5,
    });

    const now = Date.now();
    const entry = logs.entries.find(
      (e) => e.target?.id === newMember.id && now - e.createdTimestamp < 2000
    );

    if (entry) user = `<@${entry.executor?.id}>`;
  } catch (err) {
    console.warn('Failed to fetch audit log for role change:', err);
  }

  if (addedRoles.size > 0) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(t(lang, 'member_role_add'))
      .addFields(
        { name: t(lang, 'user'), value: `<@${newMember.id}>` },
        { name: t(lang, 'roles'), value: addedRoles.map((r) => r.name).join(', ') },
        { name: t(lang, 'done_by'), value: user }
      )
      .setTimestamp();

    await addToGuildLog(
      newMember.guild.id,
      'INFO',
      `User ${newMember.user?.username ?? 'Unknown'} has gotten new role(s): ${addedRoles.map((r) => r.name).join(', ')}`
    );

    await logIfEnabled(newMember.guild, 'member_role_add', embed);
  }

  if (removedRoles.size > 0) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(t(lang, 'member_role_remove'))
      .addFields(
        { name: t(lang, 'user'), value: `<@${newMember.id}>` },
        { name: t(lang, 'roles'), value: removedRoles.map((r) => r.name).join(', ') },
        { name: t(lang, 'done_by'), value: user }
      )
      .setTimestamp();

    await addToGuildLog(
      newMember.guild.id,
      'WARN',
      `User ${newMember.user?.username ?? 'Unknown'} has gotten fewer role(s): ${removedRoles.map((r) => r.name).join(', ')}`
    );

    await logIfEnabled(newMember.guild, 'member_role_remove', embed);
  }
}

// Voice events

export async function voiceStateChanged(oldState: VoiceState, newState: VoiceState) {
  if (!oldState.guild) return;
  const lang = await getGuildLanguage(oldState.guild.id);

  const memberTag = `<@${newState.member?.id}>`;

  // User joined voice
  if (!oldState.channel && newState.channel) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(t(lang, 'voice_join'))
      .addFields(
        { name: t(lang, 'user'), value: memberTag },
        { name: t(lang, 'channel'), value: newState.channel.name }
      )
      .setTimestamp();

    await addToGuildLog(
      oldState.guild.id,
      'INFO',
      `User ${oldState.member?.displayName ?? 'Unknown'} has joined voice channel ${newState.channel.name}`
    );

    await logIfEnabled(oldState.guild, 'voice_join', embed);
  }

  // User left voice OR was kicked
  else if (oldState.channel && !newState.channel) {
    let executorTag: string | null = null;
    let executorName: string | null = null;

    if (oldState.guild.members.me?.permissions.has('ViewAuditLog')) {
      try {
        const fetchedLogs = await oldState.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.MemberDisconnect,
        });

        const disconnectLog = fetchedLogs.entries.first();

        if (
          disconnectLog &&
          disconnectLog.target?.id === oldState.member?.id &&
          Date.now() - disconnectLog.createdTimestamp < 5000
        ) {
          executorTag = `<@${disconnectLog.executor?.id}>`;
          executorName =
            disconnectLog.executor?.displayName ?? disconnectLog.executor?.username ?? 'Unknown';
        }
      } catch (error) {
        console.error('Fout bij het ophalen van audit logs:', error);
      }
    }

    if (executorTag) {
      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(t(lang, 'voice_kick'))
        .addFields(
          { name: t(lang, 'user'), value: memberTag },
          { name: t(lang, 'kicked_by'), value: executorTag },
          { name: t(lang, 'channel'), value: oldState.channel.name }
        )
        .setTimestamp();

      await addToGuildLog(
        oldState.guild.id,
        'WARN',
        `User ${oldState.member?.displayName ?? 'Unknown'} was kicked from voice channel ${oldState.channel.name} by ${executorName}`
      );

      await logIfEnabled(oldState.guild, 'voice_kick', embed);
    } else {
      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(t(lang, 'voice_leave'))
        .addFields(
          { name: t(lang, 'user'), value: memberTag },
          { name: t(lang, 'channel'), value: oldState.channel.name }
        )
        .setTimestamp();

      await addToGuildLog(
        oldState.guild.id,
        'INFO',
        `User ${oldState.member?.displayName ?? 'Unknown'} has left voice channel ${oldState.channel.name}`
      );

      await logIfEnabled(oldState.guild, 'voice_leave', embed);
    }
  }

  // User switched channels
  else if (oldState.channelId !== newState.channelId) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setTitle(t(lang, 'voice_switch'))
      .addFields(
        { name: t(lang, 'user'), value: memberTag },
        { name: t(lang, 'from'), value: oldState.channel?.name ?? t(lang, 'none') },
        { name: t(lang, 'to'), value: newState.channel?.name ?? t(lang, 'none') }
      )
      .setTimestamp();

    await addToGuildLog(
      oldState.guild.id,
      'INFO',
      `User ${oldState.member?.displayName ?? 'Unknown'} has switched voice channel from ${oldState.channel?.name} to ${newState.channel?.name}`
    );

    await logIfEnabled(oldState.guild, 'voice_switch', embed);
  }

  // Mute/unmute
  if (!oldState.selfMute && newState.selfMute) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(t(lang, 'voice_mute'))
      .addFields({ name: t(lang, 'user'), value: memberTag })
      .setTimestamp();

    await addToGuildLog(
      oldState.guild.id,
      'INFO',
      `User ${oldState.member?.displayName ?? 'Unknown'} is muted in voice channel ${newState.channel?.name}`
    );

    await logIfEnabled(oldState.guild, 'voice_mute', embed);
  } else if (oldState.selfMute && !newState.selfMute) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(t(lang, 'voice_unmute'))
      .addFields({ name: t(lang, 'user'), value: memberTag })
      .setTimestamp();

    await addToGuildLog(
      oldState.guild.id,
      'INFO',
      `User ${oldState.member?.displayName ?? 'Unknown'} is unmuted in voice channel ${newState.channel?.name}`
    );

    await logIfEnabled(oldState.guild, 'voice_unmute', embed);
  }

  // Deafen/undeafen
  if (!oldState.selfDeaf && newState.selfDeaf) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(t(lang, 'voice_deafen'))
      .addFields({ name: t(lang, 'user'), value: memberTag })
      .setTimestamp();

    await addToGuildLog(
      oldState.guild.id,
      'INFO',
      `User ${oldState.member?.displayName ?? 'Unknown'} is deafened in voice channel ${newState.channel?.name}`
    );

    await logIfEnabled(oldState.guild, 'voice_deafen', embed);
  } else if (oldState.selfDeaf && !newState.selfDeaf) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(t(lang, 'voice_undeafen'))
      .addFields({ name: t(lang, 'user'), value: memberTag })
      .setTimestamp();

    await addToGuildLog(
      oldState.guild.id,
      'INFO',
      `User ${oldState.member?.displayName ?? 'Unknown'} is undeafened in voice channel ${newState.channel?.name}`
    );

    await logIfEnabled(oldState.guild, 'voice_undeafen', embed);
  }

  // Stream start/stop
  if (!oldState.streaming && newState.streaming) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(t(lang, 'voice_stream_start'))
      .addFields({ name: t(lang, 'user'), value: memberTag })
      .setTimestamp();

    await addToGuildLog(
      oldState.guild.id,
      'INFO',
      `User ${oldState.member?.displayName ?? 'Unknown'} has started streaming in voice channel ${newState.channel?.name}`
    );

    await logIfEnabled(oldState.guild, 'voice_stream_start', embed);
  } else if (oldState.streaming && !newState.streaming) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(t(lang, 'voice_stream_stop'))
      .addFields({ name: t(lang, 'user'), value: memberTag })
      .setTimestamp();

    await addToGuildLog(
      oldState.guild.id,
      'INFO',
      `User ${oldState.member?.displayName ?? 'Unknown'} has stopped streaming in voice channel ${newState.channel?.name}`
    );

    await logIfEnabled(oldState.guild, 'voice_stream_stop', embed);
  }
}

// Role events
export async function roleCreated(role: Role) {
  const lang = await getGuildLanguage(role.guild.id);
  let user = t(lang, 'unknown');
  let executor;

  try {
    const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 1 });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
    if (entry) executor = entry.executor?.username;
  } catch (err) {
    console.warn('Failed to fetch audit log for role creation:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(t(lang, 'role_create'))
    .addFields(
      { name: t(lang, 'role'), value: role.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    role.guild.id,
    'INFO',
    `User ${executor ?? 'Unknown'} has created a role: ${role.name}`
  );

  await logIfEnabled(role.guild, 'role_create', embed);
}

export async function roleDeleted(role: Role) {
  const lang = await getGuildLanguage(role.guild.id);
  let user = t(lang, 'unknown');
  let executor;
  try {
    const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
    if (entry) executor = entry.executor?.username;
  } catch (err) {
    console.warn('Failed to fetch audit log for role deletion:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle(t(lang, 'role_delete'))
    .addFields(
      { name: t(lang, 'role'), value: role.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    role.guild.id,
    'WARN',
    `User ${executor ?? 'Unknown'} has deleted a role: ${role.name}`
  );

  await logIfEnabled(role.guild, 'role_delete', embed);
}

export async function roleUpdated(oldRole: Role, newRole: Role) {
  const lang = await getGuildLanguage(newRole.guild.id);
  let user = t(lang, 'unknown');
  let executor;

  try {
    const logs = await newRole.guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 1 });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
    if (entry) executor = entry.executor?.username;
  } catch (err) {
    console.warn('Failed to fetch audit log for role update:', err);
  }

  if (oldRole.name === newRole.name) return;

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'role_update'))
    .addFields(
      { name: t(lang, 'old_role'), value: oldRole.name },
      { name: t(lang, 'new_role'), value: newRole.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    oldRole.guild.id,
    'INFO',
    `User ${executor ?? 'Unknown'} has updated a role from ${oldRole.name} to ${newRole.name}`
  );

  await logIfEnabled(newRole.guild, 'role_update', embed);
}

// Channel events
export async function channelCreated(channel: GuildChannel) {
  const lang = await getGuildLanguage(channel.guild.id);
  let user = t(lang, 'unknown');
  let executor;
  try {
    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelCreate,
      limit: 1,
    });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
    if (entry) executor = entry.executor?.username;
  } catch (err) {
    console.warn('Failed to fetch audit log for channel creation:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(t(lang, 'channel_create'))
    .addFields(
      { name: t(lang, 'channel'), value: channel.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    channel.guild.id,
    'INFO',
    `User ${executor ?? 'Unknown'} has created a channel: ${channel.name}`
  );

  await logIfEnabled(channel.guild, 'channel_create', embed);
}

export async function channelDeleted(channel: GuildChannel) {
  const lang = await getGuildLanguage(channel.guild.id);
  let user = t(lang, 'unknown');
  let executor;
  try {
    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelDelete,
      limit: 1,
    });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
    if (entry) executor = entry.executor?.username;
  } catch (err) {
    console.warn('Failed to fetch audit log for channel deletion:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle(t(lang, 'channel_delete'))
    .addFields(
      { name: t(lang, 'channel'), value: channel.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    channel.guild.id,
    'WARN',
    `User ${executor ?? 'Unknown'} has created a channel: ${channel.name}`
  );

  await logIfEnabled(channel.guild, 'channel_delete', embed);
}

export async function channelUpdated(oldChannel: GuildChannel, newChannel: GuildChannel) {
  const ignoredPrefixes = [
    '👥 Members:',
    '🚀 Boosts:',
    '🤖 Bots:',
    '🟢 Online:',
    '📁 Channels:',
    '🎭 Roles:',
  ];

  const shouldIgnore = (name: string) => ignoredPrefixes.some((prefix) => name.includes(prefix));

  if (shouldIgnore(oldChannel.name) || shouldIgnore(newChannel.name)) return;

  const lang = await getGuildLanguage(newChannel.guild.id);
  let user = t(lang, 'unknown');
  let executor;

  try {
    const logs = await newChannel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelUpdate,
      limit: 1,
    });
    const entry = logs.entries.first();
    if (entry) executor = entry.executor?.username;
    if (entry) user = `<@${entry.executor?.id}>`;
  } catch (err) {
    console.warn('Failed to fetch audit log for channel update:', err);
  }

  if (oldChannel.name === newChannel.name) return;

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'channel_update'))
    .addFields(
      { name: t(lang, 'old_channel'), value: oldChannel.name },
      { name: t(lang, 'new_channel'), value: newChannel.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    oldChannel.guild.id,
    'INFO',
    `User ${executor ?? 'Unknown'} has updated a channel from ${oldChannel.name} to ${newChannel.name}`
  );

  await logIfEnabled(newChannel.guild, 'channel_update', embed);
}

export async function channelPinsUpdated(channel: GuildChannel, time: number) {
  const lang = await getGuildLanguage(channel.guild.id);
  let user = t(lang, 'unknown');
  let executor;

  try {
    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.MessagePin, limit: 1 });
    const entry = logs.entries.first();
    if (entry) executor = entry.executor?.username;
    if (entry) user = `<@${entry.executor?.id}>`;
  } catch (err) {
    console.warn('Failed to fetch audit log for pin:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle(t(lang, 'channel_pins_update'))
    .addFields(
      { name: t(lang, 'channel'), value: channel.name },
      { name: t(lang, 'done_by'), value: user },
      { name: t(lang, 'time'), value: `<t:${Math.floor(time / 1000)}>` }
    )
    .setTimestamp();

  await addToGuildLog(
    channel.guild.id,
    'INFO',
    `User ${executor ?? 'Unknown'} has updated channel pins in ${channel.name}`
  );

  await logIfEnabled(channel.guild, 'channel_pins_update', embed);
}

// Thread events
export async function threadCreated(thread: ThreadChannel) {
  const lang = await getGuildLanguage(thread.guild.id);
  let user = t(lang, 'unknown');
  let executor;

  try {
    const logs = await thread.guild.fetchAuditLogs({
      type: AuditLogEvent.ThreadCreate,
      limit: 1,
    });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
    if (entry) executor = entry.executor?.username;
  } catch (err) {
    console.warn('Failed to fetch audit log for thread creation:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(t(lang, 'thread_create'))
    .addFields(
      { name: t(lang, 'thread'), value: thread.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    thread.guild.id,
    'INFO',
    `User ${executor} has created a thread: ${thread.name}`
  );

  await logIfEnabled(thread.guild, 'thread_create', embed);
}

export async function threadDeleted(thread: ThreadChannel) {
  const lang = await getGuildLanguage(thread.guild.id);

  let user = t(lang, 'unknown');
  let executor;

  try {
    const logs = await thread.guild.fetchAuditLogs({
      type: AuditLogEvent.ThreadDelete,
      limit: 1,
    });
    const entry = logs.entries.first();
    if (entry) user = `<@${entry.executor?.id}>`;
    if (entry) executor = entry.executor?.username;
  } catch (err) {
    console.warn('Failed to fetch audit log for thread deletion:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle(t(lang, 'thread_delete'))
    .addFields(
      { name: t(lang, 'thread'), value: thread.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    thread.guild.id,
    'WARN',
    `User ${executor} has deleted a thread: ${thread.name}`
  );

  await logIfEnabled(thread.guild, 'thread_delete', embed);
}

export async function threadUpdated(oldThread: ThreadChannel, newThread: ThreadChannel) {
  const lang = await getGuildLanguage(newThread.guild.id);

  let user = t(lang, 'unknown');
  let executor;

  try {
    const logs = await newThread.guild.fetchAuditLogs({
      type: AuditLogEvent.ThreadUpdate,
      limit: 1,
    });
    const entry = logs.entries.first();
    if (entry) executor = entry.executor?.username;

    if (entry) user = `<@${entry.executor?.id}>`;
  } catch (err) {
    console.warn('Failed to fetch audit log for thread update:', err);
  }

  if (oldThread.name === newThread.name) return;

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'thread_update'))
    .addFields(
      { name: t(lang, 'old_thread'), value: oldThread.name },
      { name: t(lang, 'new_thread'), value: newThread.name },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    oldThread.guild.id,
    'INFO',
    `User ${executor} has updated a thread from ${oldThread.name} to ${newThread.name}`
  );

  await logIfEnabled(newThread.guild, 'thread_update', embed);
}

export async function threadMemberChange(oldMember: any, newMember: any) {
  const thread = newMember.thread || oldMember.thread;
  if (!thread?.guild) return;
  const lang = await getGuildLanguage(thread.guild.id);

  let embed: EmbedBuilder;

  if (!oldMember.thread) {
    // Joined thread
    embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(t(lang, 'thread_member_join'))
      .addFields(
        { name: t(lang, 'user'), value: `<@${newMember.id}>` },
        { name: t(lang, 'thread'), value: thread.name }
      )
      .setTimestamp();
    await logIfEnabled(thread.guild, 'thread_member_join', embed);
  } else if (!newMember.thread) {
    // Left thread
    embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(t(lang, 'thread_member_leave'))
      .addFields(
        { name: t(lang, 'user'), value: `<@${oldMember.id}>` },
        { name: t(lang, 'thread'), value: thread.name }
      )
      .setTimestamp();
    await logIfEnabled(thread.guild, 'thread_member_leave', embed);
  }
}

// Guild events
export async function guildUpdated(oldGuild: any, newGuild: any) {
  const lang = await getGuildLanguage(newGuild.id);

  // Ignore if the name did not change
  if (oldGuild.name === newGuild.name) return;

  let user = t(lang, 'unknown');
  let executor: string | undefined;

  try {
    const logs = await newGuild.fetchAuditLogs({
      type: AuditLogEvent.GuildUpdate,
      limit: 1,
    });

    const entry = logs.entries.first();

    if (entry) {
      executor = entry.executor?.username;
      user = `<@${entry.executor?.id}>`;
    }
  } catch (err) {
    console.warn('Failed to fetch audit log for guild update:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'guild_update'))
    .addFields(
      { name: t(lang, 'old_name'), value: oldGuild.name || t(lang, 'none') },
      { name: t(lang, 'new_name'), value: newGuild.name || t(lang, 'none') },
      { name: t(lang, 'done_by'), value: user }
    )
    .setTimestamp();

  await addToGuildLog(
    newGuild.id,
    'WARN',
    `User ${executor ?? 'Unknown'} updated guild name from ${oldGuild.name} to ${newGuild.name}`
  );

  await logIfEnabled(newGuild, 'guild_update', embed);
}

export async function guildIntegrationsUpdated(guild: any) {
  const lang = await getGuildLanguage(guild.id);

  const { userTag, mention } = await getExecutor(guild, AuditLogEvent.IntegrationUpdate);

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'guild_integrations_update'))
    .setDescription(`${t(lang, 'guild_integrations_changed')} — ${t(lang, 'done_by')}: ${mention}`)
    .setTimestamp();

  await addToGuildLog(guild.id, 'INFO', `User ${userTag} updated guild integrations`);

  await logIfEnabled(guild, 'guild_integrations_update', embed);
}

export async function guildEmojisUpdated(guild: any) {
  const lang = await getGuildLanguage(guild.id);

  const { userTag, mention } = await getExecutor(guild, AuditLogEvent.EmojiUpdate);

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'guild_emojis_update'))
    .setDescription(`${t(lang, 'guild_emojis_changed')} — ${t(lang, 'done_by')}: ${mention}`)
    .setTimestamp();

  await addToGuildLog(guild.id, 'INFO', `User ${userTag} updated emojis in the guild`);

  await logIfEnabled(guild, 'guild_emojis_update', embed);
}

export async function guildStickersUpdated(guild: any) {
  const lang = await getGuildLanguage(guild.id);

  const { userTag, mention } = await getExecutor(guild, AuditLogEvent.StickerUpdate);

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'guild_stickers_update'))
    .setDescription(`${t(lang, 'guild_stickers_changed')} — ${t(lang, 'done_by')}: ${mention}`)
    .setTimestamp();

  await addToGuildLog(guild.id, 'INFO', `User ${userTag} updated stickers in the guild`);

  await logIfEnabled(guild, 'guild_stickers_update', embed);
}

// Scheduled events
export async function guildScheduledEventCreated(event: GuildScheduledEvent) {
  const lang = await getGuildLanguage(event.guildId);

  if (!event.guild) return;

  const { userTag, mention } = await getExecutor(
    event.guild,
    AuditLogEvent.GuildScheduledEventCreate
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(t(lang, 'guild_scheduled_event_create'))
    .addFields(
      { name: t(lang, 'event_name'), value: event.name },
      {
        name: t(lang, 'start_time'),
        value: `<t:${Math.floor((event.scheduledStartTimestamp ?? 0) / 1000)}:R>`,
      },
      { name: t(lang, 'done_by'), value: mention }
    )
    .setTimestamp();

  await addToGuildLog(
    event.guildId,
    'INFO',
    `User ${userTag} created scheduled event: ${event.name}`
  );

  await logIfEnabled(event.guild, 'guild_scheduled_event_create', embed);
}

export async function guildScheduledEventDeleted(event: GuildScheduledEvent) {
  const lang = await getGuildLanguage(event.guildId);

  if (!event.guild) return;

  const { userTag, mention } = await getExecutor(
    event.guild,
    AuditLogEvent.GuildScheduledEventDelete
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle(t(lang, 'guild_scheduled_event_delete'))
    .addFields(
      { name: t(lang, 'event_name'), value: event.name },
      { name: t(lang, 'done_by'), value: mention }
    )
    .setTimestamp();

  await addToGuildLog(
    event.guildId,
    'INFO',
    `User ${userTag} deleted scheduled event: ${event.name}`
  );

  await logIfEnabled(event.guild, 'guild_scheduled_event_delete', embed);
}

export async function guildScheduledEventUpdated(
  oldEvent: GuildScheduledEvent,
  newEvent: GuildScheduledEvent
) {
  const lang = await getGuildLanguage(newEvent.guildId);

  if (!newEvent.guild) return;

  const { userTag, mention } = await getExecutor(
    newEvent.guild,
    AuditLogEvent.GuildScheduledEventUpdate
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(t(lang, 'guild_scheduled_event_update'))
    .addFields(
      { name: t(lang, 'old_event_name'), value: oldEvent.name },
      { name: t(lang, 'new_event_name'), value: newEvent.name },
      { name: t(lang, 'done_by'), value: mention }
    )
    .setTimestamp();

  await addToGuildLog(
    newEvent.guildId,
    'INFO',
    `User ${userTag} updated scheduled event from ${oldEvent.name} to ${newEvent.name}`
  );

  await logIfEnabled(newEvent.guild, 'guild_scheduled_event_update', embed);
}

// Bot & Auto Moderation
export async function botCommandUsed(interaction: Interaction) {
  if (!interaction.guild) return;
  const lang = await getGuildLanguage(interaction.guild.id);

  const user = interaction.user ? `<@${interaction.user.id}>` : t(lang, 'unknown');
  const commandName = interaction.isCommand() ? interaction.commandName : t(lang, 'unknown');

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle(t(lang, 'bot_command_used'))
    .addFields(
      { name: t(lang, 'user'), value: user },
      { name: t(lang, 'command'), value: commandName }
    )
    .setTimestamp();

  await logIfEnabled(interaction.guild, 'bot_command_used', embed);
}

export async function autoModerationTriggered(rule: any) {
  if (!rule.guild) return;
  const lang = await getGuildLanguage(rule.guild.id);

  const user = rule.userId ? `<@${rule.userId}>` : t(lang, 'unknown');
  const reason = rule.reason || t(lang, 'none');

  const embed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle(t(lang, 'auto_moderation_trigger'))
    .addFields(
      { name: t(lang, 'user'), value: user },
      { name: t(lang, 'rule'), value: rule.ruleName || t(lang, 'unknown') },
      { name: t(lang, 'reason'), value: reason }
    )
    .setTimestamp();

  await logIfEnabled(rule.guild, 'auto_moderation_trigger', embed);
}

export async function addToGuildLog(
  guildId: string,
  type: 'INFO' | 'ERROR' | 'WARN',
  message: string
): Promise<void> {
  if (!guildId) return;

  if (!type) return;

  if (!message) return;

  try {
    await prisma.guildLog.create({
      data: {
        guildId,
        type,
        message,
      },
    });
  } catch (err) {
    console.error('Failed to save guild log to database:', err);
  }
}

async function getExecutor(guild: Guild, type: AuditLogEvent) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 1 });
    const entry = logs.entries.first();

    if (!entry)
      return { userTag: 'Unknown', mention: t(await getGuildLanguage(guild.id), 'unknown') };

    return {
      userTag: entry.executor?.username ?? 'Unknown',
      mention: `<@${entry.executor?.id}>`,
    };
  } catch (err) {
    console.warn(`Failed to fetch audit logs for ${type}:`, err);
    const lang = await getGuildLanguage(guild.id);
    return { userTag: 'Unknown', mention: t(lang, 'unknown') };
  }
}
