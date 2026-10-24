import { getWriteApi } from '../lib/influx';

/** All analytics points go to the "orbit" bucket. */
export const analyticsWriteApi = () => getWriteApi('orbit');

export interface VoiceSession {
  guildId: string;
  channelId: string;
  joinedAt: Date;
}

/** Open voice sessions, keyed by `guildId:userId`. */
export const activeVoiceSessions = new Map<string, VoiceSession>();

/** A session this old missed its leave event (bot restart, outage) and is dropped. */
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * v1 only removed a session on a matching leave event, so every missed leave
 * stayed in memory for good. Called from the analytics task.
 */
export function pruneVoiceSessions(): void {
  const cutoff = Date.now() - MAX_SESSION_MS;
  for (const [key, session] of activeVoiceSessions) {
    if (session.joinedAt.getTime() < cutoff) activeVoiceSessions.delete(key);
  }
}
