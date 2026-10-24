import { Point } from '@influxdata/influxdb-client';
import type { Task } from '../../types';
import { Logging } from '../../lib/logging';
import { analyticsWriteApi, pruneVoiceSessions } from '../../services/analytics';

/** Stores every guild's member count once a day. */
export default {
  name: 'analytics-member-counts',
  // Every day at 00:00
  schedule: '0 0 * * *',

  async execute(client) {
    const writeApi = analyticsWriteApi();

    // The gateway keeps memberCount current for cached guilds, so v1's REST
    // fetch of every guild is not needed.
    for (const guild of client.guilds.cache.values()) {
      writeApi.writePoint(
        new Point('discord_member_count')
          .tag('guild_id', guild.id)
          .intField('count', guild.memberCount)
      );
    }

    await writeApi.flush();

    pruneVoiceSessions();

    Logging.debug(`Saved member counts for ${client.guilds.cache.size} guilds`);
  },
} satisfies Task;
