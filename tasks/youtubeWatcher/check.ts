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
// Must stay well below STATE_TTL, see the age filter in run().
const MAX_VIDEO_AGE_MS = 7 * 24 * 60 * 60 * 1000;
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

      const videos = await getVideos(channelId);
      if (!videos) continue;

      // State is kept per watcher row, not per YouTube channel, so two guilds
      // watching the same channel don't cancel each other out.
      const claimKey = (videoId: string) => `yt:posted:${watcherChannel.id}:${videoId}`;
      const sinceKey = `yt:since:${watcherChannel.id}:${channelId}`;

      // Holds the moment this pair was first seen; null means first run.
      const known = await redis.get(sinceKey);

      if (known === null) {
        // First time seeing this channel — mark everything currently in the feed as
        // seen without posting, to avoid spamming old videos.
        const pipeline = redis.pipeline();
        pipeline.set(sinceKey, String(Date.now()), 'EX', STATE_TTL);
        for (const video of videos) {
          pipeline.set(claimKey(video.id), '1', 'EX', STATE_TTL);
        }
        await pipeline.exec();
        continue;
      }

      // Keep the original start moment (only refresh the TTL): the RSS feed can lag
      // behind uploads, so comparing against the previous tick would drop videos.
      await redis.expire(sinceKey, STATE_TTL);
      const since = Number(known);
      // Claims expire after STATE_TTL; without an age cap an old video that is still
      // in the feed of a quiet channel would be posted again once its claim expires.
      const maxAge = Date.now() - MAX_VIDEO_AGE_MS;

      // Oldest first, so announcements appear in upload order.
      const candidates = videos
        .filter((v) => v.published.getTime() > maxAge)
        .sort((a, b) => a.published.getTime() - b.published.getTime());

      for (const video of candidates) {
        // Atomically claim this video *before* posting. NX fails for anything we
        // already saw, so an overlapping run can't repost it.
        const claimed = await redis.set(claimKey(video.id), '1', 'EX', STATE_TTL, 'NX');
        if (!claimed) continue;

        // An entry older than the watcher itself can surface when a newer video is
        // deleted and the 15-entry feed window shifts back. Claimed above so it
        // is skipped cheaply next time, but never announced.
        if (Number.isFinite(since) && video.published.getTime() < since) continue;

        await postVideo(discordChannel, video, channelId, guildSettings?.primaryColor);
      }
    }
  }
}

async function postVideo(
  discordChannel: TextChannel,
  video: Video,
  channelId: string,
  color: string | null | undefined
) {
  Logging.info(
    `YouTubeWatcher: New video for ${channelId}: ${video.id}, posting to #${discordChannel.name}`
  );

  const embed = new EmbedBuilder()
    .setTitle(video.title.slice(0, 200))
    .setURL(video.url)
    .setAuthor({
      name: video.channelName,
      url: `https://www.youtube.com/channel/${channelId}`,
    })
    .setDescription(video.description?.slice(0, 350) || null)
    .setColor((color || '#2F3136') as ColorResolvable);

  if (video.thumbnail) {
    embed.setImage(video.thumbnail);
  }

  try {
    await discordChannel.send({ embeds: [embed] });
  } catch (err) {
    // Deliberately keep the claim: a timeout can fire after Discord accepted
    // the message, and reposting is worse than dropping one announcement.
    Logging.error(`YouTubeWatcher: Failed to post ${video.id} to ${discordChannel.id}: ${err}`);
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
      // Accept "@handle", "youtube.com/@handle", "youtube.com/@handle/videos?..." etc.
      const username = input.split('@').pop()!.split(/[/?#]/)[0]!.trim();
      if (!username) return null;

      // Scraping a full channel page every minute is what makes a run slow enough
      // to overlap the next one; the handle -> id mapping never changes.
      // v2: older entries may hold a wrong id from the previous, too loose regex.
      const cacheKey = `yt:channelId:v2:${username.toLowerCase()}`;
      const cached = await redis.get(cacheKey);
      if (cached) return cached;

      const res = await axios.get(`https://www.youtube.com/@${username}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });

      // Only patterns that identify the page owner. Generic "channelId"/"browseId"
      // also appear for featured/recommended channels, and the first of those on the
      // page is often someone else's channel (e.g. @TomleyRC resolved to Phil_H).
      const patterns = [
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/,
        /<meta itemprop="identifier" content="(UC[A-Za-z0-9_-]{22})"/,
        /"externalId":"(UC[A-Za-z0-9_-]{22})"/,
        /"channelUrl":"https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/,
      ];

      for (const pattern of patterns) {
        const match = res.data.match(pattern);
        if (match?.[1]) {
          await redis.set(cacheKey, match[1], 'EX', CHANNEL_ID_TTL);
          return match[1];
        }
      }

      Logging.warn(`YouTubeWatcher: Could not resolve channel id for @${username}`);
      return null;
    }

    Logging.warn(`YouTubeWatcher: Unrecognised YouTube channel input: ${input}`);
    return null;
  } catch (err) {
    Logging.error(`YouTubeWatcher: Failed to resolve channel id for ${input}: ${err}`);
    return null;
  }
}

type Video = {
  id: string;
  title: string;
  url: string;
  description: string | null;
  thumbnail: string | null;
  channelName: string;
  published: Date;
};

/** All entries in the channel's RSS feed (YouTube returns the 15 most recent). */
async function getVideos(channelId: string): Promise<Video[] | null> {
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
    const rawVideos: any[] = Array.isArray(entries) ? entries : entries ? [entries] : [];

    return rawVideos
      .map((video): Video | null => {
        const videoId = video['yt:videoId'];
        const published = new Date(video.published);
        if (!videoId || Number.isNaN(published.getTime())) return null;

        const link = Array.isArray(video.link)
          ? video.link.find((l: any) => l['@_rel'] === 'alternate')
          : video.link;

        // Description and thumbnail come from media:group — no extra HTTP requests needed
        const mediaGroup = video['media:group'];
        const description = mediaGroup?.['media:description'];
        const thumbnail = mediaGroup?.['media:thumbnail']?.['@_url'];

        return {
          id: String(videoId),
          title: String(video.title),
          url: link?.['@_href'] ?? `https://www.youtube.com/watch?v=${videoId}`,
          description: description != null ? String(description) : null,
          thumbnail: thumbnail ?? null,
          channelName,
          published,
        };
      })
      .filter((v): v is Video => v !== null);
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
