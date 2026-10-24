import { type Client, type ColorResolvable, EmbedBuilder, type TextChannel } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { Logging } from '../../lib/logging';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { getGuildSettings } from '../../lib/guildSettings';

const redis = getRedisClient();

const STATE_TTL = 60 * 60 * 24 * 30; // 30 days
const CHANNEL_ID_TTL = 60 * 60 * 24; // 1 day
const LOCK_KEY = 'yt:task:lock';
const LOCK_TTL = 300; // safety net if a run dies without releasing

async function task(client: Client) {
  // A single run can easily outlive the one-minute cron interval (HTTP calls per
  // watched channel). Without this lock two runs overlap, both read the same state
  // and both post the same video.
  const lock = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL, 'NX');
  if (!lock) {
    Logging.warn('YouTubeWatcher: previous run still in progress, skipping this tick');
    return;
  }

  try {
    await run(client);
  } finally {
    await redis.del(LOCK_KEY);
  }
}

async function run(client: Client) {
  const cachedData = await redis.get('youtubeWatcherData');

  const watchers = cachedData
    ? JSON.parse(cachedData)
    : await prisma.youtubeWatcher.findMany({
        where: { enabled: true },
        include: { channels: true },
      });

  if (!cachedData) {
    await redis.set('youtubeWatcherData', JSON.stringify(watchers), 'EX', 120);
  }

  for (const watcher of watchers) {
    const guild = client.guilds.cache.get(watcher.guildId);
    if (!guild) continue;

    const guildSettings = await getGuildSettings(watcher.guildId);
    if (!guildSettings) continue;

    for (const watcherChannel of watcher.channels) {
      let discordChannel: TextChannel | null = null;

      try {
        discordChannel = (await guild.channels.fetch(watcherChannel.discordChannel)) as TextChannel;
      } catch {
        Logging.error(`YouTubeWatcher: Channel no longer exists: ${watcherChannel.discordChannel}`);
        continue;
      }

      if (!discordChannel) continue;

      const channelId = await resolveChannelId(watcherChannel.youtubeChannel);
      if (!channelId) continue;

      const latest = await getLatestVideo(channelId);
      if (!latest) continue;

      // State is kept per watcher row, not per YouTube channel, so two guilds
      // watching the same channel don't cancel each other out.
      const initKey = `yt:init:${watcherChannel.id}:${channelId}`;
      const claimKey = `yt:posted:${watcherChannel.id}:${latest.id}`;

      // Refresh the TTL only if this pair was seen before; null means first run.
      const known = await redis.set(initKey, latest.id, 'EX', STATE_TTL, 'XX');

      if (!known) {
        // First time seeing this channel — register without posting to avoid spamming old videos
        await redis.set(initKey, latest.id, 'EX', STATE_TTL);
        await redis.set(claimKey, '1', 'EX', STATE_TTL);
        continue;
      }

      // Atomically claim this video *before* posting. NX fails for anything we
      // already posted, so a reordered RSS feed or an overlapping run can't repost it.
      const claimed = await redis.set(claimKey, '1', 'EX', STATE_TTL, 'NX');
      if (!claimed) continue;

      Logging.info(
        `YouTubeWatcher: New video for ${channelId}: ${latest.id}, posting to #${discordChannel.name}`
      );

      const embed = new EmbedBuilder()
        .setTitle(latest.title.slice(0, 200))
        .setURL(latest.url)
        .setAuthor({
          name: latest.channelName,
          url: `https://www.youtube.com/channel/${channelId}`,
        })
        .setDescription(latest.description?.slice(0, 350) ?? null)
        .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable);

      if (latest.thumbnail) {
        embed.setImage(latest.thumbnail);
      }

      try {
        await discordChannel.send({ embeds: [embed] });
      } catch (err) {
        // Deliberately keep the claim: a timeout can fire after Discord accepted
        // the message, and reposting is worse than dropping one announcement.
        Logging.error(
          `YouTubeWatcher: Failed to post ${latest.id} to ${watcherChannel.discordChannel}: ${err}`
        );
      }
    }
  }
}

async function resolveChannelId(input: string): Promise<string | null> {
  try {
    if (input.includes('channel/')) {
      const id = input.split('channel/')[1]?.split(/[/?]/)[0];
      return id || null;
    }

    // Bare UC channel ID
    if (/^UC[A-Za-z0-9_-]{22}$/.test(input)) {
      return input;
    }

    // @handle — scrape channel page
    if (input.includes('@')) {
      const username = input.split('@').pop()!;

      // Scraping a full channel page every minute is what makes a run slow enough
      // to overlap the next one; the handle -> id mapping never changes.
      const cacheKey = `yt:channelId:${username}`;
      const cached = await redis.get(cacheKey);
      if (cached) return cached;

      const res = await axios.get(`https://www.youtube.com/@${username}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });

      const patterns = [
        /"channelId":"(UC[A-Za-z0-9_-]+)"/,
        /"externalChannelId":"(UC[A-Za-z0-9_-]+)"/,
        /"browseId":"(UC[A-Za-z0-9_-]+)"/,
        /\/channel\/(UC[A-Za-z0-9_-]{22})/,
        /"channelUrl":"https:\\\/\\\/www\.youtube\.com\\\/channel\\\/(UC[A-Za-z0-9_-]+)"/,
      ];

      for (const pattern of patterns) {
        const match = res.data.match(pattern);
        if (match?.[1]) {
          await redis.set(cacheKey, match[1], 'EX', CHANNEL_ID_TTL);
          return match[1];
        }
      }

      return null;
    }

    return null;
  } catch (err) {
    return null;
  }
}

async function getLatestVideo(channelId: string) {
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const res = await axios.get(url);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    const feed = parser.parse(res.data);

    // Channel name lives at feed level
    const channelName: string = feed.feed?.author?.name ?? feed.feed?.title ?? 'Unknown Channel';

    const entries = feed.feed?.entry;
    const videos = Array.isArray(entries) ? entries : entries ? [entries] : [];
    if (!videos.length) return null;

    // The feed is not guaranteed to be ordered, so pick the newest explicitly
    // instead of trusting entry[0].
    const video = videos.reduce((newest: any, entry: any) =>
      new Date(entry.published) > new Date(newest.published) ? entry : newest
    );

    const videoId: string = video['yt:videoId'];

    const link = Array.isArray(video.link)
      ? video.link.find((l: any) => l['@_rel'] === 'alternate')
      : video.link;

    // Description and thumbnail come from media:group — no extra HTTP requests needed
    const mediaGroup = video['media:group'];
    const description: string | null = mediaGroup?.['media:description'] ?? null;
    const thumbnail: string | null = mediaGroup?.['media:thumbnail']?.['@_url'] ?? null;

    return {
      id: videoId,
      title: String(video.title),
      url: link?.['@_href'] ?? `https://www.youtube.com/watch?v=${videoId}`,
      description,
      thumbnail,
      channelName,
      published: new Date(video.published),
    };
  } catch (err) {
    Logging.error(`YouTubeWatcher: Failed to fetch RSS for ${channelId}: ${err}`);
    return null;
  }
}

export default {
  name: 'youtube-watcher',
  schedule: '* * * * *',

  async execute(client) {
    await task(client);
  },
} satisfies Task;
