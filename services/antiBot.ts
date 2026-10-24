import { EmbedBuilder, GuildMember, Message, TextChannel, ColorResolvable } from 'discord.js';
import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/redis';
import { t } from '../lib/i18n';
import { Logging } from '../lib/logging';
import { getGuildSettings } from '../lib/guildSettings';
import { GuildLogger } from '../lib/guildLog';

const redis = getRedisClient();

const ZALGO_REGEX = /[̀-ͯ҉᷀-᷿⃐-⃿︠-︯]{3,}/;

const CSAM_KEYWORDS = [
  /\bcp\b/i,
  /\bteen\s*(solo|boys?|girls?)\b/i,
  /young\s*(boys?|girls?|teens?)/i,
  /brutal.*mega.*link/i,
  /zangi/i,
  /confidential.*correspondence/i,
];

function isCsamSpam(content: string): boolean {
  return CSAM_KEYWORDS.some((p) => p.test(content));
}

//  Settings loader (Redis-cached)

async function getSettings(guildId: string): Promise<any | null> {
  const raw = await redis.get(`antibot:${guildId}`);
  if (raw) return JSON.parse(raw);

  const settings = await prisma.antiBotSettings.findUnique({ where: { guildId } });
  if (!settings) return null;

  await redis.set(`antibot:${guildId}`, JSON.stringify(settings), 'EX', 600);
  return settings;
}

//  Punishment helper

/**
 * Applies the configured punishment to a member.
 * Pass `triggerMessage` to delete it on kick (deleteMessagesOnKick).
 */
async function applyPunishment(
  member: GuildMember,
  reason: string,
  settings: any,
  triggerMessage?: Message
): Promise<void> {
  switch (settings.punishment) {
    case 'mute':
      if (member.moderatable) {
        try {
          await member.timeout(10 * 60 * 1000, reason);
        } catch (err: any) {
          Logging.error(`[AntiBot] Failed to mute ${member.id}: ${err}`);
        }
      }
      break;

    case 'kick':
      if (member.kickable) {
        if (settings.deleteMessagesOnKick && triggerMessage) {
          await triggerMessage.delete().catch(() => null);
        }

        try {
          await member.kick(reason);
          await clearWelcomeMessage(member);
        } catch (err: any) {
          Logging.error(`[AntiBot] Failed to kick ${member.id}: ${err}`);
        }
      }
      break;

    case 'ban':
      if (member.bannable) {
        const deleteMessageSeconds = settings.deleteMessagesOnBan
          ? Math.min(7, Math.max(0, settings.deleteMessagesDays ?? 1)) * 86_400
          : 0;

        try {
          await member.ban({ reason, deleteMessageSeconds });
          await clearWelcomeMessage(member);
        } catch (err: any) {
          Logging.error(`[AntiBot] Failed to ban ${member.id}: ${err}`);
        }
      }
      break;

    case 'jail':
      if (settings.jailRole) {
        const role = member.guild.roles.cache.get(settings.jailRole);
        if (role) {
          try {
            await member.roles.add(role, reason);
          } catch (err: any) {
            Logging.error(`[AntiBot] Failed to add jail role to ${member.id}: ${err}`);
          }
        }
      }
      break;

    case 'none':
    default:
      break;
  }
}

//  Message handler

export async function handleMessage(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || message.webhookId) return;

  const guildId = message.guild.id;
  const settings = await getSettings(guildId);
  if (!settings?.enabled) return;

  const member = message.member;
  if (!member) return;

  const isAdmin = member.permissions.has('ManageGuild');

  //  0. CSAM
  if (isCsamSpam(message.content)) {
    await message.delete().catch(() => null);
    await applyPunishment(member, 'CSAM/spam detected', settings, message);
    await sendNotification(message, 'csam_detected', settings);
    return;
  }

  // Skip everything for admins when excludeAdmins is on
  if (settings.excludeAdmins && isAdmin) return;

  //  1. Discord invite block
  if (settings.blockInvites && !isAdmin) {
    const handled = await checkDiscordInvite(message, settings);
    if (handled) return;
  }

  //  2. NSFW invite block
  if (settings.blockNSFWInvites && !isAdmin) {
    const handled = await checkNsfwInvite(message, settings);
    if (handled) return;
  }

  //  3. Forbidden words
  if (Array.isArray(settings.forbiddenWords) && settings.forbiddenWords.length > 0) {
    const hit = (settings.forbiddenWords as string[]).find((word) =>
      message.content.toLowerCase().includes(word.toLowerCase())
    );
    if (hit) {
      await message.delete().catch(() => null);
      await applyPunishment(member, 'Forbidden word detected', settings);
      await sendNotification(message, 'used_forbidden_word', settings);
      return;
    }
  }

  //  4. Forbidden patterns (regex)
  if (Array.isArray(settings.forbiddenPatterns) && settings.forbiddenPatterns.length > 0) {
    const hit = (settings.forbiddenPatterns as string[]).find((pattern) => {
      try {
        return new RegExp(pattern, 'i').test(message.content);
      } catch {
        return false; // invalid regex → skip
      }
    });
    if (hit) {
      await message.delete().catch(() => null);
      await applyPunishment(member, 'Forbidden pattern matched', settings, message);
      await sendNotification(message, 'forbidden_pattern_matched', settings);
      return;
    }
  }

  //  5. Zalgo / unicode abuse
  if (settings.blockZalgo && ZALGO_REGEX.test(message.content)) {
    await message.delete().catch(() => null);
    await applyPunishment(member, 'Zalgo/unicode abuse detected', settings, message);
    await sendNotification(message, 'zalgo_detected', settings);
    return;
  }

  //  6. Mention spam
  const mentionCount = message.mentions.users.size + (message.mentions.everyone ? 1 : 0);
  if (mentionCount >= (settings.mentionLimit ?? 5)) {
    await message.delete().catch(() => null);
    await applyPunishment(member, 'Mention spam detected', settings, message);
    await sendNotification(message, 'mention_spam_detected', settings);
    return;
  }

  //  7. Duplicate / copy-paste spam
  if (settings.blockDuplicates) {
    const handled = await checkDuplicateSpam(message, settings);
    if (handled) return;
  }

  //  8. Message flood (same channel)
  {
    const handled = await checkMessageFlood(message, settings);
    if (handled) return;
  }

  //  9. Channel spam (spreading across channels)
  await checkChannelSpam(message, settings);
}

//  Spam detectors

/** Counts unique channels per user in the time window. */
async function checkChannelSpam(message: Message, settings: any): Promise<boolean> {
  const member = message.member!;
  const channelKey = `antibot_channels:${message.guild!.id}:${message.author.id}`;

  await redis.sadd(channelKey, message.channel.id);
  await redis.expire(channelKey, settings.timeWindow);

  const uniqueChannels = await redis.scard(channelKey);
  if (uniqueChannels < settings.channelLimit) return false;

  await applyPunishment(member, 'Channel spam detected', settings, message);
  await sendNotification(message, 'to_many_messages_in_different_channels', settings);
  await redis.del(channelKey);
  return true;
}

/** Counts messages per user per channel in the time window. */
async function checkMessageFlood(message: Message, settings: any): Promise<boolean> {
  const limit: number = settings.messageLimit ?? 8;
  if (limit <= 0) return false;

  const member = message.member!;
  const floodKey = `antibot_flood:${message.guild!.id}:${message.author.id}:${message.channel.id}`;

  const count = await redis.incr(floodKey);
  if (count === 1) await redis.expire(floodKey, settings.timeWindow);
  if (count < limit) return false;

  await applyPunishment(member, 'Message flood detected', settings, message);
  await sendNotification(message, 'message_flood_detected', settings);
  await redis.del(floodKey);
  return true;
}

/** Detects when a user repeatedly sends the same message (3+ identical). */
async function checkDuplicateSpam(message: Message, settings: any): Promise<boolean> {
  const content = message.content.trim();
  if (!content) return false;

  const member = message.member!;

  // Use base64-encoded content (first 200 chars) as part of the key
  const encoded = Buffer.from(content.toLowerCase().slice(0, 200)).toString('base64').slice(0, 64);
  const dupKey = `antibot_dup:${message.guild!.id}:${message.author.id}:${encoded}`;

  const count = await redis.incr(dupKey);
  if (count === 1) await redis.expire(dupKey, settings.timeWindow);
  if (count < 3) return false;

  await message.delete().catch(() => null);
  await applyPunishment(member, 'Duplicate spam detected', settings);
  await sendNotification(message, 'duplicate_spam_detected', settings);
  await redis.del(dupKey);
  return true;
}

//  Invite checks

async function checkDiscordInvite(message: Message, settings: any): Promise<boolean> {
  const inviteRegex =
    /(https?:\/\/)?(www\.)?(discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i;
  if (!inviteRegex.test(message.content)) return false;

  await message.delete().catch(() => null);
  await applyPunishment(message.member!, 'Discord invite detected', settings, message);
  await sendNotification(message, 'non_admin_send_discord_invite', settings);
  return true;
}

async function checkNsfwInvite(message: Message, settings: any): Promise<boolean> {
  const inviteRegex = /discord(?:\.gg|app\.com\/invite|\.com\/invite)\/([a-zA-Z0-9-]+)/gi;
  const matches = [...message.content.matchAll(inviteRegex)];
  if (matches.length === 0) return false;

  const nsfwKeywords = [
    'nsfw',
    '18+',
    '18plus',
    'adults only',
    'adult only',
    'adult content',
    'porn',
    'porno',
    'xxx',
    'erotic',
    'erotica',
    'cam',
    'goon',
    'hentai',
    'ecchi',
    'lewd',
    'lewds',
    'r34',
    'rule34',
    'loli',
    'shotacon',
    'nudes',
    'nude',
    'onlyfans',
    'fansly',
    'fetish',
    'kink',
  ];

  for (const match of matches) {
    const code = match[1];
    try {
      // Resolving an invite is an API call, so cache the verdict: a spam wave
      // posting the same link would otherwise hit Discord once per message.
      const cacheKey = `antibot:invite_nsfw:${code}`;
      const cached = await redis.get(cacheKey).catch(() => null);

      let isNsfw: boolean;

      if (cached !== null) {
        isNsfw = cached === '1';
      } else {
        const invite = await message.client.fetchInvite(code);
        const guild = invite.guild;
        if (!guild) continue;

        const isNsfwLevel = guild.nsfwLevel === 1 || guild.nsfwLevel === 3;
        const nameAndDesc = `${guild.name} ${guild.description ?? ''}`.toLowerCase();
        const hasNsfwKeyword = nsfwKeywords.some((kw) => nameAndDesc.includes(kw));

        isNsfw = isNsfwLevel || hasNsfwKeyword;
        await redis.set(cacheKey, isNsfw ? '1' : '0', 'EX', 3600).catch(() => null);
      }

      if (!isNsfw) continue;

      await message.delete().catch(() => null);
      await applyPunishment(message.member!, 'NSFW invite detected', settings, message);
      await sendNotification(message, 'nsfw_invite_detected', settings);
      return true;
    } catch {
      // Invalid / expired invite — skip
    }
  }

  return false;
}

//  Member join handler

export async function handleMemberJoin(member: GuildMember): Promise<void> {
  if (!member.guild || member.user.bot) return;

  const guildId = member.guild.id;
  const settings = await getSettings(guildId);
  if (!settings?.enabled) return;

  //  1. Forbidden username
  if (Array.isArray(settings.forbiddenUsernames) && settings.forbiddenUsernames.length > 0) {
    const username = member.user.username.toLowerCase();
    const displayName = member.displayName.toLowerCase();

    const hit = (settings.forbiddenUsernames as string[]).find((word) => {
      const w = word.toLowerCase();
      return username.includes(w) || displayName.includes(w);
    });

    if (hit) {
      await applyPunishment(member, 'Forbidden username detected', settings);
      await sendJoinNotification(member, 'forbidden_username_detected', settings);
      return;
    }
  }

  //  2. New account age check
  const minDays: number = settings.minAccountAgeDays ?? 7;
  if (minDays > 0) {
    const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;

    if (accountAgeDays < minDays) {
      await sendJoinNotification(member, 'new_account_detected', settings);

      const action: string = settings.newAccountAction ?? 'none';
      if (action !== 'none') {
        // newAccountAction has its own action separate from the global punishment
        await applyPunishment(member, 'New account detected', {
          ...settings,
          punishment: action,
        });
      }
      return;
    }
  }

  //  3. Raid detection
  const threshold: number = settings.raidThreshold ?? 5;
  if (threshold > 0) {
    await checkRaidDetection(member, settings);
  }
}

/** Tracks joins in the last 10 seconds; punishes if threshold is exceeded. */
async function checkRaidDetection(member: GuildMember, settings: any): Promise<void> {
  const raidKey = `antibot_raid:${member.guild.id}`;

  const count = await redis.incr(raidKey);
  // Set 10-second window on first join
  if (count === 1) await redis.expire(raidKey, 10);

  const threshold: number = settings.raidThreshold ?? 5;
  if (count < threshold) return;

  // Punish using the global punishment setting
  await applyPunishment(member, 'Raid detection triggered', settings);
  await sendJoinNotification(member, 'raid_detected', settings);
}

//  Notifications

async function sendNotification(message: Message, reason: string, settings: any): Promise<void> {
  if (!message?.guild || !settings?.notificationChannel) return;

  const channel = message.guild.channels.cache.get(settings.notificationChannel) as TextChannel;
  if (!channel?.isTextBased()) return;

  let member = message.member;
  if (!member) return;

  if (member.partial) {
    try {
      member = await member.fetch();
    } catch (err) {
      Logging.error(`[AntiBot] Failed to fetch partial member: ${err}`);
      return;
    }
  }

  const embed = await buildNotificationEmbed(message.guild.id, member.id, reason, settings);
  await channel
    .send({ embeds: [embed] })
    .catch((err) => Logging.error(`[AntiBot] Could not send notification: ${err}`));
}

async function sendJoinNotification(
  member: GuildMember,
  reason: string,
  settings: any
): Promise<void> {
  if (!settings?.notificationChannel) return;

  const channel = member.guild.channels.cache.get(settings.notificationChannel) as TextChannel;
  if (!channel?.isTextBased()) return;

  const embed = await buildNotificationEmbed(member.guild.id, member.id, reason, settings);
  await channel
    .send({ embeds: [embed] })
    .catch((err) => Logging.error(`[AntiBot] Could not send join notification: ${err}`));
}

async function buildNotificationEmbed(
  guildId: string,
  memberId: string,
  reason: string,
  settings: any
): Promise<EmbedBuilder> {
  const guildSettings = await getGuildSettings(guildId);
  const lang: string = guildSettings?.language ?? 'en';

  return new EmbedBuilder()
    .setTitle(t(lang, 'anti_bot_notification'))
    .setColor((guildSettings?.primaryColor ?? '#2F3136') as ColorResolvable)
    .setDescription(`${t(lang, 'triggered_by')}: <@${memberId}>`)
    .addFields(
      { name: t(lang, 'reason'), value: t(lang, reason) },
      { name: t(lang, 'punishment'), value: t(lang, settings.punishment) }
    );
}

//  Welcome message cleanup

async function clearWelcomeMessage(member: GuildMember): Promise<void> {
  const welcomeSettings = await prisma.welcomeMessageSettings.findFirst({
    where: { guildId: member.guild.id },
  });

  if (!welcomeSettings?.deleteMessage) return;

  const messageInfo = await prisma.welcomeMessagesSended.findFirst({
    where: {
      guildId: member.guild.id,
      userId: member.user.id,
    },
  });

  if (!messageInfo) return;

  try {
    const channel = await member.client.channels.fetch(messageInfo.channelId);

    if (!channel?.isTextBased()) {
      GuildLogger.error(member.guild.id, 'Welcome message channel could not be found.');
      return;
    }

    const msg = await channel.messages.fetch(messageInfo.messageId);
    if (msg) await msg.delete();

    await prisma.welcomeMessagesSended.delete({ where: { id: messageInfo.id } });
  } catch (error) {
    Logging.error(`[AntiBot] Failed to delete welcome message: ${error}`);
  }
}
