import { type ColorResolvable, EmbedBuilder } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { getRedisClient } from '../../lib/redis';
import { t } from '../../lib/i18n';

const getStreamLink = (user: string) => `https://kick.com/${user}/live`;

/**
 * Safety net on the "already announced" marker. It is normally cleared the
 * moment the stream goes offline; the TTL only matters if the bot is down when
 * that happens.
 */
const LIVE_MARKER_TTL = 60 * 60 * 12;

function getUsernameFromUrl(url: string): string {
  if (!url.includes('kick.com')) {
    return url.toLowerCase();
  }
  const match = url.match(/kick\.com\/([\w\d_]+)/i);
  return match?.[1] ? match[1].toLowerCase() : '';
}

/**
 * Returns the live stream data, `null` when the channel is offline, or
 * `undefined` when the lookup itself failed. The caller must not treat a
 * failed lookup as "offline", that would clear the announced-marker and cause
 * a duplicate announcement on the next tick.
 */
async function getLiveStreamData(username: string) {
  try {
    const response = await fetch(`https://kick.com/api/v2/channels/${username}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        Accept: 'application/json',
        Referer: `https://kick.com/${username}`,
        Origin: 'https://kick.com',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      Logging.error(`Failed to fetch data for ${username}: ${response.status}`);
      return undefined;
    }

    const data: any = await response.json();

    if (data.livestream) {
      Logging.trace(`User ${username} is live`);
      const livestreamData = data.livestream;
      return {
        title: livestreamData?.session_title as string | undefined,
        viewers: livestreamData?.viewer_count,
        thumbnail: livestreamData?.thumbnail?.url as string | undefined,
        started_at: livestreamData?.created_at,
        category: livestreamData?.categories?.[0]?.name,
        streamLink: getStreamLink(username),
      };
    }

    return null;
  } catch (error) {
    Logging.error(`Error checking live status: ${error}`);
    return undefined;
  }
}

export default {
  name: 'kick-watcher',
  schedule: '* * * * *',

  async execute(client) {
    const redis = getRedisClient();

    const kickSettings = await prisma.kickWatcher.findMany({
      where: { enabled: true },
    });

    for (const setting of kickSettings) {
      const channel = await client.channels.fetch(setting.channel).catch(() => null);

      if (!channel) {
        Logging.error(`KickWatcher: Channel no longer exists: ${setting.channel}`);
        continue;
      }

      if (!channel.isSendable()) continue;

      const users: string[] = (setting.users as string[] | null) ?? [];

      const guildSettings = await getGuildSettings(setting.guildId);
      const embedColor = guildSettings?.primaryColor || '#2F3136';

      for (const userUrl of users) {
        const username = getUsernameFromUrl(userUrl);
        if (!username) {
          Logging.error('⚠️ Invalid username extracted, skipping...');
          continue;
        }

        const notifiedKey = `kick:notify:${setting.guildId}:${username}`;
        const data = await getLiveStreamData(username);

        // Lookup failed — leave the state untouched and retry next tick.
        if (data === undefined) continue;

        if (data === null) {
          await redis.del(notifiedKey).catch(() => null);
          continue;
        }

        // Claim atomically so overlapping ticks cannot both announce.
        const claimed = await redis.set(notifiedKey, '1', 'EX', LIVE_MARKER_TTL, 'NX');
        if (!claimed) continue;

        const title = data.title || t(guildSettings?.language, 'kick_now_live_title', { username });

        const embed = new EmbedBuilder()
          .setTitle(title.slice(0, 200))
          .setURL(data.streamLink)
          .setDescription(t(guildSettings?.language, 'kick_now_live_description', { username }))
          .setColor(embedColor as ColorResolvable);

        if (data.thumbnail) embed.setImage(data.thumbnail);

        try {
          await channel.send({ embeds: [embed] });
        } catch (error) {
          // Keep the marker: a failed send is better than announcing in a loop.
          Logging.error(`KickWatcher: could not announce ${username}: ${error}`);
        }
      }
    }
  },
} satisfies Task;
