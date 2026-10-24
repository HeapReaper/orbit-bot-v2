import {
  type Client,
  GuildMember,
  Message,
  MessageReaction,
  PartialGuildMember,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
  TextChannel,
  User,
} from 'discord.js';
import type { ModerationFilter } from '../generated/prisma/client';
import { getRedisClient } from '../lib/redis';
import { Logging } from '../lib/logging';
import { t } from '../lib/i18n';
import { getGuildSettings } from '../lib/guildSettings';
import {
  applyAction,
  getModerationConfig,
  isFilterIgnored,
  isImmune,
  logFilterHit,
  ModerationActionName,
  ModerationConfig,
} from './moderation';

const redis = getRedisClient();

/**
 * Evaluation order. The cheap content checks run before the ones that need
 * Redis or an API call, and the first match wins.
 */
const FILTER_ORDER = [
  'csam',
  'words',
  'patterns',
  'zalgo',
  'capitals',
  'newlines',
  'mentions',
  'links',
  'nsfwInvites',
  'invites',
  'duplicates',
  'spam',
  'channelSpam',
  'attachments',
] as const;

/** Filters that judge a single message, so they can re-run on an edit. */
const CONTENT_FILTERS: string[] = [
  'csam',
  'words',
  'patterns',
  'zalgo',
  'capitals',
  'newlines',
  'mentions',
  'links',
  'nsfwInvites',
  'invites',
];

/**
 * Filters that judge a single member on join, in this order, first match wins.
 * The raid filter is not in here: it looks at the whole join wave and runs
 * before these, so a join another filter acts on is still counted.
 */
const MEMBER_FILTER_ORDER = ['usernames', 'accountAge'] as const;

const ZALGO_REGEX = /[̀-ͯ҉᷀-᷿⃐-⃿︠-︯]{3,}/;
const INVITE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/gi;
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>]+/gi;

/** How long the alert to the member stays in the channel. */
const ALERT_LIFETIME_MS = 8000;

/**
 * Wording that keeps coming back in the child sexual abuse material spam waves
 * that hit Discord servers. Guilds can add their own patterns on top through
 * the filter entries.
 */
const CSAM_PATTERNS = [
  /\bcp\b/i,
  /\bteen\s*(solo|boys?|girls?)\b/i,
  /young\s*(boys?|girls?|teens?)/i,
  /brutal.*mega.*link/i,
  /zangi/i,
  /confidential.*correspondence/i,
];

/** Names and descriptions with one of these read as an adult server. */
const NSFW_KEYWORDS = [
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * An edit on an uncached message arrives partial, without content or author,
 * so it has to be fetched before any filter can look at it.
 */
export async function handleMessageUpdate(updated: Message | PartialMessage): Promise<void> {
  let message = updated;

  if (message.partial) {
    const fetched = await message.fetch().catch(() => null);
    if (!fetched) return;
    message = fetched;
  }

  await handleMessage(message as Message, true);
}

/**
 * @param contentOnly Set for edits: re-running the rate based filters would
 *   count the same message a second time.
 */
export async function handleMessage(message: Message, contentOnly = false): Promise<void> {
  if (!message.guild || message.webhookId) return;

  const config = await getModerationConfig(message.guild.id);
  if (!config?.enabled) return;
  if (message.author.bot && config.ignoreBots) return;

  let member = message.member;
  if (!member) {
    member = await message.guild.members.fetch(message.author.id).catch(() => null);
  }
  if (!member) return;

  if (isImmune(member, config, message.channel.id)) return;

  for (const type of FILTER_ORDER) {
    if (contentOnly && !CONTENT_FILTERS.includes(type)) continue;

    const filter = config.filters.find((item) => item.type === type && item.enabled);
    if (!filter) continue;
    if (isFilterIgnored(filter, member, message.channel.id)) continue;

    const matched = await matches(filter, message);
    if (!matched) continue;

    await handleHit(message, member, filter, config);
    return;
  }
}

async function matches(filter: ModerationFilter, message: Message): Promise<boolean> {
  switch (filter.type) {
    case 'words':
      return matchesWords(filter, message.content);

    case 'patterns':
      return matchesPatterns(filter.entries, message.content);

    case 'csam':
      // The built-in list is the point of this filter, the entries only add
      return (
        CSAM_PATTERNS.some((pattern) => pattern.test(message.content)) ||
        matchesPatterns(filter.entries, message.content)
      );

    case 'zalgo':
      return ZALGO_REGEX.test(message.content);

    case 'capitals':
      return matchesCapitals(filter, message.content);

    case 'newlines':
      return (message.content.match(/\n/g) ?? []).length > filter.limit;

    case 'mentions': {
      const mentions =
        message.mentions.users.size +
        message.mentions.roles.size +
        (message.mentions.everyone ? 1 : 0);
      return mentions > filter.limit;
    }

    case 'links':
      return matchesLinks(filter, message.content);

    case 'invites':
      return matchesInvites(filter, message);

    case 'nsfwInvites':
      return matchesNsfwInvites(filter, message);

    case 'duplicates':
      return matchesDuplicates(filter, message);

    case 'spam':
      return matchesSpam(filter, message);

    case 'channelSpam':
      return matchesChannelSpam(filter, message);

    case 'attachments':
      return matchesAttachments(filter, message);

    default:
      return false;
  }
}

/**
 * Runs the guild's own regular expressions. A pattern that does not compile
 * is skipped instead of taking the whole filter down with it — the dashboard
 * already refuses to save one, but stored rows can predate that check.
 */
function matchesPatterns(entries: string[], content: string): boolean {
  return entries.some((entry) => {
    if (entry.trim() === '') return false;

    try {
      return new RegExp(entry, 'i').test(content);
    } catch {
      return false;
    }
  });
}

function matchesWords(filter: ModerationFilter, content: string): boolean {
  const entries = filter.entries.filter((entry) => entry.trim() !== '');
  if (entries.length === 0) return false;

  // Match on word boundaries so "ass" does not flag "class", while still
  // allowing multi word phrases as an entry.
  const pattern = entries.map(escapeRegex).join('|');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${pattern})(?:[^\\p{L}\\p{N}]|$)`, 'iu').test(content);
}

function matchesCapitals(filter: ModerationFilter, content: string): boolean {
  if (content.length < filter.minimumLength) return false;

  const letters = content.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return false;

  const uppercase = letters.replace(/[^\p{Lu}]/gu, '').length;
  return (uppercase / letters.length) * 100 > filter.limit;
}

function matchesLinks(filter: ModerationFilter, content: string): boolean {
  const matches = content.match(URL_REGEX);
  if (!matches) return false;

  const hostnames = matches
    .map((raw) => {
      try {
        return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.toLowerCase();
      } catch {
        return null;
      }
    })
    .filter((host): host is string => host !== null);

  if (hostnames.length === 0) return false;

  const entries = filter.entries
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  const isListed = (host: string) =>
    entries.some((entry) => host === entry || host.endsWith(`.${entry}`));

  if (filter.entriesMode === 'whitelist') {
    // Nothing allowed yet means every link is blocked, which is the
    // literal reading of an empty allow list.
    return hostnames.some((host) => !isListed(host));
  }

  // A block list without entries blocks every link
  if (entries.length === 0) return true;
  return hostnames.some(isListed);
}

async function matchesInvites(filter: ModerationFilter, message: Message): Promise<boolean> {
  const codes = [...message.content.matchAll(INVITE_REGEX)].map((match) => match[1]);
  if (codes.length === 0) return false;

  const allowed = filter.entries.map((entry) => entry.trim()).filter((entry) => entry !== '');

  for (const code of codes) {
    const targetGuildId = await resolveInviteGuild(message.client, code);

    // An invite that cannot be resolved is still an invite
    if (!targetGuildId) return true;

    // Invites to this very server are never advertising
    if (targetGuildId === message.guild!.id) continue;
    if (allowed.includes(targetGuildId)) continue;

    return true;
  }

  return false;
}

/**
 * Resolving an invite is an API call, so the verdict is cached: a spam wave
 * posting the same link would otherwise hit Discord once per message.
 */
async function resolveInviteGuild(client: Client, code: string): Promise<string | null> {
  const cacheKey = `moderation:invite:${code}`;

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return cached === 'unknown' ? null : cached;

  try {
    const invite = await client.fetchInvite(code);
    const guildId = invite.guild?.id ?? null;

    await redis.set(cacheKey, guildId ?? 'unknown', 'EX', 3600).catch(() => null);
    return guildId;
  } catch {
    await redis.set(cacheKey, 'unknown', 'EX', 600).catch(() => null);
    return null;
  }
}

/**
 * Flags invites to age restricted servers, which is a separate call from the
 * invite filter: a guild can allow invites in general and still refuse these.
 */
async function matchesNsfwInvites(filter: ModerationFilter, message: Message): Promise<boolean> {
  const codes = [...message.content.matchAll(INVITE_REGEX)].map((match) => match[1]);
  if (codes.length === 0) return false;

  const extra = filter.entries
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  for (const code of codes) {
    if (await isNsfwInvite(message.client, code, extra)) return true;
  }

  return false;
}

/**
 * Resolving an invite is an API call, so the verdict is cached per invite.
 * The guild's own keywords are applied on top of the cached description, not
 * baked into the cache, so editing the list takes effect right away.
 */
async function isNsfwInvite(
  client: Client,
  code: string,
  extraKeywords: string[]
): Promise<boolean> {
  const cacheKey = `moderation:invite:nsfw:${code}`;

  let profile: { nsfw: boolean; text: string } | null = null;

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    profile = JSON.parse(cached) as { nsfw: boolean; text: string };
  } else {
    try {
      const invite = await client.fetchInvite(code);
      const guild = invite.guild;
      if (!guild) return false;

      profile = {
        // 1 is "explicit", 3 is "age restricted"
        nsfw: guild.nsfwLevel === 1 || guild.nsfwLevel === 3,
        text: `${guild.name} ${guild.description ?? ''}`.toLowerCase(),
      };

      await redis.set(cacheKey, JSON.stringify(profile), 'EX', 3600).catch(() => null);
    } catch {
      // An expired or invalid invite tells us nothing about its server
      return false;
    }
  }

  if (profile.nsfw) return true;

  return [...NSFW_KEYWORDS, ...extraKeywords].some((keyword) => profile.text.includes(keyword));
}

/** Counts the different channels a member posts in inside the window. */
async function matchesChannelSpam(filter: ModerationFilter, message: Message): Promise<boolean> {
  const key = `moderation:channels:${message.guild!.id}:${message.author.id}`;

  await redis.sadd(key, message.channel.id);
  await redis.expire(key, filter.window);

  const channels = await redis.scard(key);
  if (channels <= filter.limit) return false;

  // Reset so the member is not flagged again on every following message
  await redis.del(key);
  return true;
}

async function matchesDuplicates(filter: ModerationFilter, message: Message): Promise<boolean> {
  const content = message.content.trim().toLowerCase();
  if (!content) return false;

  const encoded = Buffer.from(content.slice(0, 200)).toString('base64').slice(0, 64);
  const key = `moderation:dup:${message.guild!.id}:${message.author.id}:${encoded}`;

  return countInWindow(key, filter.window, filter.limit);
}

async function matchesSpam(filter: ModerationFilter, message: Message): Promise<boolean> {
  const key = `moderation:spam:${message.guild!.id}:${message.author.id}`;
  return countInWindow(key, filter.window, filter.limit);
}

async function matchesAttachments(filter: ModerationFilter, message: Message): Promise<boolean> {
  if (message.attachments.size === 0) return false;

  const key = `moderation:attach:${message.guild!.id}:${message.author.id}`;
  const count = await redis.incrby(key, message.attachments.size);
  if (count === message.attachments.size) await redis.expire(key, filter.window);

  if (count <= filter.limit) return false;

  await redis.del(key);
  return true;
}

/** Increments a rolling counter and reports whether it passed the limit. */
async function countInWindow(key: string, window: number, limit: number): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, window);

  if (count <= limit) return false;

  // Reset so the member is not flagged again on every following message
  await redis.del(key);
  return true;
}

async function handleHit(
  message: Message,
  member: GuildMember,
  filter: ModerationFilter,
  config: ModerationConfig
): Promise<void> {
  if (filter.delete) {
    await message.delete().catch(() => null);
  }

  if (filter.alert) {
    await sendAlert(message, filter);
  }

  await logFilterHit(member, filter, message.channel.id, config, message.content);
  await registerInfraction(member, filter, config);
}

async function sendAlert(message: Message, filter: ModerationFilter): Promise<void> {
  const channel = message.channel as TextChannel;
  if (!channel.isTextBased()) return;

  const guildSettings = await getGuildSettings(message.guild!.id);
  const lang = guildSettings?.language ?? 'en';

  const alert = await channel
    .send({
      content: t(lang, 'moderation_alert', {
        user: `<@${message.author.id}>`,
        filter: t(lang, `moderation_filter_${filter.type}`),
      }),
    })
    .catch(() => null);

  if (!alert) return;

  // The alert is a notice, not a second wall of text in the channel
  setTimeout(() => {
    void alert.delete().catch(() => null);
  }, ALERT_LIFETIME_MS);
}

/**
 * Counts offences inside the filter window and punishes once the configured
 * threshold is reached.
 */
async function registerInfraction(
  member: GuildMember,
  filter: ModerationFilter,
  config: ModerationConfig
): Promise<void> {
  const action = filter.hardAction as ModerationActionName;
  if (action === 'none') return;

  const key = `moderation:hits:${member.guild.id}:${member.id}:${filter.type}`;

  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, filter.thresholdDuration);
  if (count < filter.thresholdMaximum) return;

  await redis.del(key);

  const guildSettings = await getGuildSettings(member.guild.id);
  const lang = guildSettings?.language ?? 'en';

  await applyAction({
    member,
    action,
    reason: t(lang, 'moderation_filter_reason', {
      filter: t(lang, `moderation_filter_${filter.type}`),
      count: String(count),
    }),
    config,
    duration: filter.hardActionDuration,
    filterType: filter.type,
  });
}

/** Reaction spam is counted per member, the message itself is left alone. */
export async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): Promise<void> {
  if (user.bot) return;

  // A reaction on an uncached message arrives partial, and so does the
  // message behind it, so neither carries a guild until it is fetched.
  let target = reaction;
  if (target.partial) {
    const fetched = await target.fetch().catch(() => null);
    if (!fetched) return;
    target = fetched;
  }

  const message = target.message.partial
    ? await target.message.fetch().catch(() => null)
    : target.message;

  const guild = message?.guild;
  if (!message || !guild) return;

  const config = await getModerationConfig(guild.id);
  if (!config?.enabled) return;

  const filter = config.filters.find((item) => item.type === 'reactions' && item.enabled);
  if (!filter) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  if (isImmune(member, config, message.channel.id)) return;
  if (isFilterIgnored(filter, member, message.channel.id)) return;

  const key = `moderation:reactions:${guild.id}:${user.id}`;
  const hit = await countInWindow(key, filter.window, filter.limit);
  if (!hit) return;

  if (filter.delete) {
    await target.users.remove(user.id).catch(() => null);
  }

  await logFilterHit(member, filter, message.channel.id, config, '');
  await registerInfraction(member, filter, config);
}

//  Member filters

/**
 * A join is checked against the member filters. The username and the account
 * age are per member, the raid check looks at the whole join wave.
 */
export async function handleMemberJoin(member: GuildMember): Promise<void> {
  const config = await getModerationConfig(member.guild.id);
  if (!config?.enabled) return;
  if (member.user.bot && config.ignoreBots) return;

  const raidFilter = config.filters.find((item) => item.type === 'raid' && item.enabled);
  if (raidFilter && (await handleRaid(member, raidFilter, config))) return;

  if (isImmune(member, config)) return;

  for (const type of MEMBER_FILTER_ORDER) {
    const filter = config.filters.find((item) => item.type === type && item.enabled);
    if (!filter) continue;
    if (isFilterIgnored(filter, member)) continue;

    const matched =
      type === 'usernames' ? matchesUsername(filter, member) : matchesAccountAge(filter, member);

    if (!matched) continue;

    await handleMemberHit(member, filter, config);
    return;
  }
}

/**
 * A member can pass the username filter on join and rename themselves right
 * after, so the same check runs again whenever the displayed name changes.
 */
export async function handleMemberUpdate(
  previous: GuildMember | PartialGuildMember,
  updated: GuildMember
): Promise<void> {
  // Roles, boosts and timeouts also fire this event, only a rename matters
  if (
    previous.nickname === updated.nickname &&
    previous.user?.username === updated.user.username &&
    previous.user?.globalName === updated.user.globalName
  ) {
    return;
  }

  const config = await getModerationConfig(updated.guild.id);
  if (!config?.enabled) return;
  if (updated.user.bot && config.ignoreBots) return;

  const filter = config.filters.find((item) => item.type === 'usernames' && item.enabled);
  if (!filter) return;

  if (isImmune(updated, config)) return;
  if (isFilterIgnored(filter, updated)) return;
  if (!matchesUsername(filter, updated)) return;

  await handleMemberHit(updated, filter, config);
}

/** Matches the blocked words anywhere inside the username or nickname. */
function matchesUsername(filter: ModerationFilter, member: GuildMember): boolean {
  const entries = filter.entries
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  if (entries.length === 0) return false;

  // All three are visible to other members, so all three are checked
  const names = [member.user.username, member.user.globalName, member.nickname]
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());

  return entries.some((entry) => names.some((name) => name.includes(entry)));
}

/** `limit` is the minimum account age in days. */
function matchesAccountAge(filter: ModerationFilter, member: GuildMember): boolean {
  const ageInDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
  return ageInDays < filter.limit;
}

/**
 * Counts the joins inside the window and reports whether this member was
 * part of a raid. The members that joined before the threshold was crossed
 * belong to the same wave, so they are handled too rather than only the one
 * that happened to tip it over.
 *
 * The counter and the queue are separate keys: emptying a Redis list drops
 * it, and with it the window, which would let the rest of the wave through.
 */
async function handleRaid(
  member: GuildMember,
  filter: ModerationFilter,
  config: ModerationConfig
): Promise<boolean> {
  const countKey = `moderation:raid:${member.guild.id}`;
  const queueKey = `moderation:raid:queue:${member.guild.id}`;

  const joins = await redis.incr(countKey);
  if (joins === 1) await redis.expire(countKey, filter.window);

  // Below the threshold this is still an ordinary join, but it is remembered
  // in case the wave grows past the threshold inside the same window.
  if (joins < filter.limit) {
    await redis.rpush(queueKey, member.id);
    if (joins === 1) await redis.expire(queueKey, filter.window);
    return false;
  }

  const queued = await redis.lrange(queueKey, 0, -1);
  await redis.del(queueKey);

  let acted = false;

  for (const id of [...queued, member.id]) {
    const target =
      id === member.id ? member : await member.guild.members.fetch(id).catch(() => null);

    if (!target) continue;
    if (isImmune(target, config)) continue;
    if (isFilterIgnored(filter, target)) continue;

    await handleMemberHit(target, filter, config);
    if (target.id === member.id) acted = true;
  }

  return acted;
}

/** A member filter has no message to remove, so it only logs and punishes. */
async function handleMemberHit(
  member: GuildMember,
  filter: ModerationFilter,
  config: ModerationConfig
): Promise<void> {
  await logFilterHit(member, filter, null, config, '');
  await registerInfraction(member, filter, config);
}
