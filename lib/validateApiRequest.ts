import type { Request, Response } from 'express';
import { getRedisClient } from './redis';
import { decrypt } from './crypto';
import { prisma } from './prisma';
import { Logging } from './logging';

const redis = getRedisClient();

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

/**
 * Authenticates an API request and applies a per-IP rate limit.
 *
 * On failure this sends the response itself and returns `false`; callers must
 * simply `return` without touching `res` again. (It used to return the value of
 * `res.status(...).json(...)`, which is truthy, so a rejected request read as a
 * successful one and the handler carried on and tried to respond twice.)
 */
export async function validateApiRequest(req: Request, res: Response): Promise<boolean> {
  // Rate limit
  try {
    const redisKey = `rate_limit:api:${req.ip}`;
    const requests = await redis.incr(redisKey);

    if (requests === 1) {
      await redis.expire(redisKey, RATE_LIMIT_WINDOW_SECONDS);
    } else if (requests > RATE_LIMIT_MAX_REQUESTS) {
      res.status(429).json({
        error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX_REQUESTS} requests per minute.`,
      });
      return false;
    }
  } catch (err) {
    Logging.error(`validateApiRequest: rate limit check failed: ${err}`);
    res.status(500).json({ error: 'Internal server error' });
    return false;
  }

  // API key (auth)
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return false;
  }

  const apiKey = authHeader.slice('Bearer '.length).trim();
  if (!apiKey) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return false;
  }

  const guildId = req.headers['x-guild-id'] as string | undefined;
  if (!guildId) {
    res.status(400).json({ error: 'Missing X-Guild-ID header' });
    return false;
  }

  let apiSettings;
  try {
    apiSettings = await prisma.guildApiSettings.findFirst({ where: { guildId } });
  } catch (err) {
    Logging.error(`validateApiRequest: could not load API settings for ${guildId}: ${err}`);
    res.status(500).json({ error: 'Internal server error' });
    return false;
  }

  if (!apiSettings || !apiSettings.enabled || !apiSettings.apiKey) {
    res.status(403).json({ error: 'API access is not enabled for this guild' });
    return false;
  }

  let expectedKey: string;
  try {
    expectedKey = decrypt(apiSettings.apiKey);
  } catch (err) {
    Logging.error(`validateApiRequest: could not decrypt API key for ${guildId}: ${err}`);
    res.status(500).json({ error: 'Internal server error' });
    return false;
  }

  if (!timingSafeEquals(apiKey, expectedKey)) {
    res.status(401).json({ error: 'Invalid API key' });
    return false;
  }

  return true;
}

/** Constant-time compare so a wrong key cannot be recovered byte by byte. */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}
