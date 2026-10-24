import { Events } from 'discord.js';
import { Point } from '@influxdata/influxdb-client';
import { defineEvent } from '../../types';
import { Logging } from '../../lib/logging';
import { activeVoiceSessions, analyticsWriteApi } from '../../services/analytics';

/** Records how long a member spent in a voice channel. */
export default defineEvent({
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    const userId = newState.id;
    const guildId = newState.guild.id;
    const key = `${guildId}:${userId}`;

    // User joins a VC
    if (!oldState.channelId && newState.channelId) {
      activeVoiceSessions.set(key, {
        guildId,
        channelId: newState.channelId,
        joinedAt: new Date(),
      });
      Logging.debug(`User ${userId} joined VC ${newState.channelId}`);
      return;
    }

    // User leaves or switches VC
    if (oldState.channelId && (!newState.channelId || newState.channelId !== oldState.channelId)) {
      const session = activeVoiceSessions.get(key);
      if (!session) return;

      const leftAt = new Date();
      const duration = Math.floor((leftAt.getTime() - session.joinedAt.getTime()) / 1000);

      try {
        analyticsWriteApi().writePoint(
          new Point('discord_voice_activity')
            .tag('guild_id', session.guildId)
            .tag('channel_id', session.channelId)
            .tag('user_id', userId)
            .intField('duration', duration)
            .timestamp(session.joinedAt)
        );
        Logging.debug(`Queued VC session for InfluxDB for ${userId} (${duration}s)`);
      } catch (error) {
        Logging.error(`Error saving VC session to InfluxDB: ${error}`);
      }

      activeVoiceSessions.delete(key);

      if (newState.channelId) {
        activeVoiceSessions.set(key, {
          guildId,
          channelId: newState.channelId,
          joinedAt: new Date(),
        });
      }
    }
  },
});
