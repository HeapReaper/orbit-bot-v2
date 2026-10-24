import { type Client, type ColorResolvable, EmbedBuilder, type TextChannel } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { Logging } from '../../lib/logging';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { getGuildSettings } from '../../lib/guildSettings';
import { createHash } from 'crypto';

const redis = getRedisClient();

const LOCK_KEY = 'rss:task:lock';
/** Safety net so a run that dies without releasing cannot wedge the task. */
const LOCK_TTL = 300;

interface RssItem {
  id: string;
  title: string;
  url: string;
  description: string | null;
  thumbnail: string | null;
  feedTitle: string;
  published: Date | null;
}

async function task(client: Client) {
  // A run makes one HTTP request per configured feed and can easily outlive
  // the one-minute interval; without this two runs interleave, both see the
  // same "last seen" id and both post the same item.
  const lock = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL, 'NX');
  if (!lock) {
    Logging.warn('Rss: previous run still in progress, skipping this tick');
    return;
  }

  try {
    await run(client);
  } finally {
    await redis.del(LOCK_KEY);
  }
}

async function run(client: Client) {
  const settings = await prisma.rssSettings.findMany({
    where: { enabled: true, channelId: { not: null } },
    include: { Rss: true },
  });

  for (const setting of settings) {
    const guild = client.guilds.cache.get(setting.guildId);
    if (!guild) continue;

    const guildSettings = await getGuildSettings(setting.guildId);

    for (const feed of setting.Rss) {
      const latest = await getLatestItem(feed.url);
      if (!latest) continue;

      const redisKey = `rss:last:${feed.id}`;
      const lastSeen = await redis.get(redisKey);

      if (!lastSeen) {
        await redis.set(redisKey, latest.id, 'EX', 60 * 60 * 24 * 30);
        continue;
      }

      if (latest.id === lastSeen) continue;

      // Title-based dedup: prevent the same title (per feed URL) from being posted twice within 6 hours.
      // This catches cases where multiple feed configs point to the same RSS URL.
      const titleHash = createHash('md5').update(`${feed.url}:${latest.title}`).digest('hex');
      const titleKey = `rss:title:${titleHash}`;
      const titleAlreadySent = await redis.get(titleKey);
      if (titleAlreadySent) {
        Logging.info(`Rss: Skipping duplicate title "${latest.title}" for feed ${feed.url}`);
        // Still update the last-seen ID so we don't keep hitting this check next minute
        await redis.set(redisKey, latest.id, 'EX', 60 * 60 * 24 * 30);
        continue;
      }

      // Fetching channel. A feed may override the channel; fall back to the
      // guild-wide one instead of calling fetch(null).
      const channelId = feed.channelId ?? setting.channelId;
      if (!channelId) continue;

      let channel: TextChannel | null = null;
      try {
        channel = (await guild.channels.fetch(channelId)) as TextChannel;
      } catch {
        Logging.error(`Rss: Channel no longer exists: ${channelId}`);
        continue;
      }

      if (!channel?.isTextBased()) continue;

      const embed = new EmbedBuilder()
        .setTitle(latest.title.slice(0, 200))
        .setURL(latest.url)
        .setAuthor({ name: latest.feedTitle.slice(0, 256) })
        .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable);

      if (latest.description) {
        embed.setDescription(latest.description.slice(0, 350));
      }

      if (latest.thumbnail) {
        embed.setImage(latest.thumbnail);
      }

      if (latest.published) {
        embed.setTimestamp(latest.published);
      }

      try {
        await channel.send({ embeds: [embed] });
      } catch (error) {
        // Leave the last-seen id untouched so the item is retried next tick.
        Logging.error(`Rss: could not post ${latest.url} to ${channel.id}: ${error}`);
        continue;
      }

      await redis.set(redisKey, latest.id, 'EX', 60 * 60 * 24 * 30);
      // Mark title as sent for 6 hours to block duplicate posts from other feed configs
      await redis.set(titleKey, '1', 'EX', 60 * 60 * 6);
    }
  }
}

async function getLatestItem(url: string): Promise<RssItem | null> {
  try {
    const res = await axios.get(url, {
      timeout: 10_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OrbitBot/1.0; +https://github.com/HeapReaper)',
      },
    });

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    const parsed = parser.parse(res.data);

    // Atom feed
    if (parsed.feed) {
      return parseAtomItem(parsed.feed);
    }

    // RSS 2.0
    if (parsed.rss?.channel) {
      return parseRssItem(parsed.rss.channel);
    }

    return null;
  } catch (err) {
    Logging.error(`Rss: Failed to fetch feed ${url}: ${err}`);
    return null;
  }
}

function parseAtomItem(feed: any): RssItem | null {
  const entry = Array.isArray(feed.entry) ? feed.entry[0] : feed.entry;
  if (!entry) return null;

  const feedTitle: string = feed.title?.['#text'] ?? feed.title ?? 'Unknown Feed';

  const link = Array.isArray(entry.link)
    ? (entry.link.find((l: any) => l['@_rel'] === 'alternate') ?? entry.link[0])
    : entry.link;

  const url: string = link?.['@_href'] ?? link ?? '';
  if (!url) return null;

  const id: string = entry.id ?? url;
  const title: string = entry.title?.['#text'] ?? String(entry.title ?? 'Untitled');
  const description: string | null =
    entry.summary?.['#text'] ?? entry.summary ?? entry.content?.['#text'] ?? entry.content ?? null;

  const thumbnail: string | null =
    entry['media:thumbnail']?.['@_url'] ??
    entry['media:group']?.['media:thumbnail']?.['@_url'] ??
    null;

  const published = entry.published ?? entry.updated ?? null;

  return {
    id,
    title,
    url,
    description: stripHtml(description),
    thumbnail,
    feedTitle,
    published: published ? new Date(published) : null,
  };
}

function parseRssItem(channel: any): RssItem | null {
  const items = channel.item;
  const item = Array.isArray(items) ? items[0] : items;
  if (!item) return null;

  const feedTitle: string = channel.title ?? 'Unknown Feed';
  const url: string = item.link ?? '';
  if (!url) return null;

  const id: string = item.guid?.['#text'] ?? item.guid ?? url;
  const title: string = String(item.title ?? 'Untitled');
  const description: string | null = item.description ?? item['content:encoded'] ?? null;

  const thumbnail: string | null =
    item['media:thumbnail']?.['@_url'] ??
    item['media:content']?.['@_url'] ??
    item.enclosure?.['@_url'] ??
    null;

  const pubDate = item.pubDate ?? item['dc:date'] ?? null;

  return {
    id,
    title,
    url,
    description: stripHtml(description),
    thumbnail,
    feedTitle,
    published: pubDate ? new Date(pubDate) : null,
  };
}

function stripHtml(input: string | null): string | null {
  if (!input) return null;
  return input.replace(/<[^>]*>/g, '').trim() || null;
}

export default {
  name: 'rss',
  schedule: '* * * * *',

  async execute(client) {
    await task(client);
  },
} satisfies Task;
