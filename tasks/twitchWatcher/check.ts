import type { Client } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getRedisClient } from '../../lib/redis';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

const CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? '';
// The deployed .env names this TWITCH_SECRET_CODE; TWITCH_CLIENT_SECRET is kept
// as an alias so either spelling works.
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET ?? process.env.TWITCH_SECRET_CODE ?? '';

const TOKEN_KEY = 'twitch:app_token';
/** Twitch allows 100 user_login values per /helix/streams call. */
const STREAMS_BATCH_SIZE = 100;
/** Safety net: drop the "already announced" marker if we never see the stream end. */
const LIVE_MARKER_TTL = 60 * 60 * 12;

interface TwitchStream {
  user_login: string;
  title?: string;
}

/**
 * App access tokens are valid for ~60 days, so they are cached in Redis and
 * only re-requested when they expire. The previous version asked Twitch for a
 * fresh token every single minute.
 */
async function getTwitchToken(): Promise<string | null> {
  const redis = getRedisClient();
  const cached = await redis.get(TOKEN_KEY).catch(() => null);
  if (cached) return cached;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    Logging.error('TwitchWatcher: TWITCH_CLIENT_ID / TWITCH_SECRET_CODE are not configured');
    return null;
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
    method: 'POST',
  });

  if (!response.ok) {
    Logging.error(`TwitchWatcher: could not obtain token (HTTP ${response.status})`);
    return null;
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    Logging.error('TwitchWatcher: token response did not contain an access_token');
    return null;
  }

  // Expire a minute early so a token is never used right as it lapses.
  const ttl = Math.max(60, (data.expires_in ?? 3600) - 60);
  await redis.set(TOKEN_KEY, data.access_token, 'EX', ttl).catch(() => null);

  return data.access_token;
}

/** Returns the logins from `usernames` that are currently streaming. */
async function getLiveUsernames(usernames: string[], token: string): Promise<Set<string>> {
  const redis = getRedisClient();
  const live = new Set<string>();

  for (let i = 0; i < usernames.length; i += STREAMS_BATCH_SIZE) {
    const batch = usernames.slice(i, i + STREAMS_BATCH_SIZE);
    const params = new URLSearchParams();
    for (const username of batch) params.append('user_login', username);

    const response = await fetch(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
      headers: {
        'Client-ID': CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      // Token was revoked or expired early — drop it so the next tick fetches a new one.
      await redis.del(TOKEN_KEY).catch(() => null);
      Logging.error('TwitchWatcher: token rejected by Twitch, cleared cache');
      return live;
    }

    if (!response.ok) {
      Logging.error(`TwitchWatcher: /helix/streams returned HTTP ${response.status}`);
      continue;
    }

    const data = (await response.json()) as { data?: TwitchStream[] };
    for (const stream of data.data ?? []) {
      if (stream.user_login) live.add(stream.user_login.toLowerCase());
    }
  }

  return live;
}

function getUsernameFromUrl(url: string): string {
  if (!url) return '';

  const match = url.match(/twitch\.tv\/([\w\d_]+)/i);
  if (match?.[1]) return match[1].toLowerCase();

  // Allow a bare username to be configured as well.
  return /^[\w\d_]+$/.test(url) ? url.toLowerCase() : '';
}

async function handleTask(client: Client) {
  const redis = getRedisClient();
  const twitchSettings = await prisma.twitchWatcher.findMany({ where: { enabled: true } });
  if (twitchSettings.length === 0) return;

  const token = await getTwitchToken();
  if (!token) return;

  // One lookup for every watched streamer across all guilds instead of one
  // HTTP request per streamer per guild.
  const perSetting = twitchSettings.map((setting) => ({
    setting,
    usernames: ((setting.users as string[] | null) ?? [])
      .map((url) => getUsernameFromUrl(url))
      .filter((username): username is string => Boolean(username)),
  }));

  const allUsernames = [...new Set(perSetting.flatMap((entry) => entry.usernames))];
  if (allUsernames.length === 0) return;

  const liveUsernames = await getLiveUsernames(allUsernames, token);

  for (const { setting, usernames } of perSetting) {
    const channel = await client.channels.fetch(setting.channel).catch(() => null);

    if (!channel) {
      Logging.error(`TwitchWatcher: channel no longer exists: ${setting.channel}`);
      continue;
    }

    if (!channel.isSendable()) continue;

    const guildSettings = await getGuildSettings(setting.guildId);

    for (const username of usernames) {
      const notifiedKey = `twitch:notified:${setting.guildId}:${username}`;

      if (!liveUsernames.has(username)) {
        // Stream ended — clear the marker so the next broadcast is announced again.
        await redis.del(notifiedKey).catch(() => null);
        continue;
      }

      // Claim the announcement atomically: without this the task posted the
      // same "now live" message every minute for the whole broadcast.
      const claimed = await redis.set(notifiedKey, '1', 'EX', LIVE_MARKER_TTL, 'NX');
      if (!claimed) continue;

      try {
        await channel.send(
          t(guildSettings?.language, 'twitch_now_live', {
            username,
            url: `https://twitch.tv/${username}`,
          })
        );
      } catch (error) {
        // Keep the marker: a failed send is better than announcing in a loop.
        Logging.error(`TwitchWatcher: could not announce ${username}: ${error}`);
      }
    }
  }
}

export default {
  name: 'twitch-watcher',
  schedule: '* * * * *',

  async execute(client) {
    await handleTask(client);
  },
} satisfies Task;
