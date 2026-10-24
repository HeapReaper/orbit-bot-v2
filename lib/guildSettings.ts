import { prisma } from './prisma';
import { getRedisClient } from './redis';
import { Logging } from './logging';

export interface BotSettings {
  id: number;
  guildId: string;
  nickname?: string | null;
  language?: string | null;
  updatesChannel?: string | null;
  timezone?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  createdAt: Date;
  showInGuildList: boolean;
}

const CACHE_TTL_SECONDS = 320;

// Default configuration
const DEFAULT_SETTINGS = {
  id: 0, // dummy id for defaults
  nickname: 'Orbit',
  language: 'en',
  updatesChannel: null,
  timezone: 'Europe/Amsterdam',
  primaryColor: '#000000', // Black
  secondaryColor: '#000000', // Black
  showInGuildList: true,
};

/**
 * Null columns in the database must not override the defaults above, otherwise a
 * guild that never picked a language ends up with `language: null` instead of "en".
 */
function withDefaults(guildId: string, settings: Record<string, unknown> | null): BotSettings {
  const defined = Object.fromEntries(
    Object.entries(settings ?? {}).filter(([, value]) => value !== null && value !== undefined)
  );

  return { ...DEFAULT_SETTINGS, createdAt: new Date(), guildId, ...defined } as BotSettings;
}

export async function getGuildSettings(guildId: string): Promise<BotSettings> {
  const redis = getRedisClient();
  const redisKey = `bot_settings:${guildId}`;

  // Try to get from cache. A broken cache entry must never take the whole
  // command down with it — fall through to the database instead.
  try {
    const cachedData = await redis.get(redisKey);

    if (cachedData) {
      return withDefaults(guildId, JSON.parse(cachedData));
    }
  } catch (error) {
    Logging.warn(`getGuildSettings: could not read cache for ${guildId}: ${error}`);
  }

  const settings = await prisma.botSettings.findUnique({
    where: { guildId },
  });

  if (settings) {
    await redis
      .set(redisKey, JSON.stringify(settings), 'EX', CACHE_TTL_SECONDS)
      .catch((error) => Logging.warn(`getGuildSettings: could not cache ${guildId}: ${error}`));
  }

  return withDefaults(guildId, settings);
}

/** Shortcut for the many handlers that only need the guild's language. */
export async function getGuildLanguage(guildId: string): Promise<string> {
  const settings = await getGuildSettings(guildId);
  return settings.language || 'en';
}
