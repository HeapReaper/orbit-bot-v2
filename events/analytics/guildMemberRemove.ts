import { Events } from 'discord.js';
import { Point } from '@influxdata/influxdb-client';
import { defineEvent } from '../../types';
import { Logging } from '../../lib/logging';
import { analyticsWriteApi } from '../../services/analytics';

export default defineEvent({
  name: Events.GuildMemberRemove,
  execute(member) {
    try {
      analyticsWriteApi().writePoint(
        new Point('discord_membership')
          .tag('guild_id', member.guild.id)
          .tag('user_id', member.id)
          .tag('event', 'leave')
          .intField('value', 1)
      );
      Logging.debug(`Queued member leave for InfluxDB: ${member.user?.tag ?? member.id}`);
    } catch (error) {
      Logging.error(`Error saving member leave to InfluxDB: ${error}`);
    }
  },
});
