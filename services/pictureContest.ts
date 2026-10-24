import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/redis';

export async function getContests(guildId: string): Promise<any[]> {
  const redisKey = `picture_contest:${guildId}`;

  const redis = getRedisClient();
  const cached = await redis.get(redisKey);
  if (cached) return JSON.parse(cached);

  const contests = await prisma.pictureContestItem.findMany({
    where: { guildId, enabled: true },
  });
  await redis.set(redisKey, JSON.stringify(contests), 'EX', 320);

  return contests;
}
