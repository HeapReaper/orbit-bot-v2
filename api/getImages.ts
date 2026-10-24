import { type Collection, type Message, type Snowflake, TextChannel } from 'discord.js';
import type { ApiRoutes } from '../types';
import { validateApiRequest } from '../lib/validateApiRequest';

const CACHE_TTL_MS = 5 * 60 * 1000;

type ImageEntry = {
  url: string;
  uploadedAt: string;
  uploadedBy: { id: string; username: string; displayName: string };
};

type CacheEntry = {
  images: ImageEntry[];
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

/**
 * v1 only ever added to this cache and never removed anything, so every
 * channel/limit combination ever requested stayed in memory for good. Expired
 * entries are now dropped whenever a new one is stored.
 */
function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export default ((app, client) => {
  app.get('/api/get-images-api', async (req, res) => {
    if (!(await validateApiRequest(req, res))) return;

    const { channelId, limit } = req.query;

    if (!channelId || typeof channelId !== 'string') {
      return res.status(400).json({ error: 'channelId is required' });
    }

    // Discord returns at most 100 messages per request
    const messageLimit = limit ? Math.min(parseInt(limit as string, 10), 100) : 100;
    if (isNaN(messageLimit) || messageLimit < 1) {
      return res.status(400).json({ error: 'limit must be a positive number' });
    }

    const cacheKey = `${channelId}:${messageLimit}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({
        channelId,
        total: cached.images.length,
        images: cached.images,
        cached: true,
      });
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) {
      return res.status(404).json({ error: 'Channel not found or not a text channel' });
    }

    // cache: false — these messages are only read once to build the response
    const messages: Collection<Snowflake, Message> = await channel.messages.fetch({
      limit: messageLimit,
      cache: false,
    });

    const images: ImageEntry[] = [];

    const meta = (message: Message, url: string): ImageEntry => ({
      url,
      uploadedAt: message.createdAt.toISOString(),
      uploadedBy: {
        id: message.author.id,
        username: message.author.username,
        displayName: message.member?.displayName ?? message.author.displayName,
      },
    });

    for (const message of messages.values()) {
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType?.startsWith('image/')) {
          images.push(meta(message, attachment.url));
        }
      }
      for (const embed of message.embeds) {
        if (embed.image?.url) images.push(meta(message, embed.image.url));
        if (embed.thumbnail?.url) images.push(meta(message, embed.thumbnail.url));
      }
    }

    pruneCache();
    cache.set(cacheKey, { images, expiresAt: Date.now() + CACHE_TTL_MS });

    res.json({ channelId, total: images.length, images });
  });
}) satisfies ApiRoutes;
