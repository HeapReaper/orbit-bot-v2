import { Events } from 'discord.js';
import { Point } from '@influxdata/influxdb-client';
import { defineEvent } from '../../types';
import { Logging } from '../../lib/logging';
import { analyticsWriteApi } from '../../services/analytics';

export default defineEvent({
  name: Events.MessageCreate,
  execute(message) {
    if (message.author.bot) return;

    const isCommand = message.content.startsWith('!');
    const commandName = isCommand ? (message.content.split(' ')[0] ?? '').substring(1) : '';

    try {
      analyticsWriteApi().writePoint(
        new Point('discord_messages')
          .tag('guild_id', message.guild?.id ?? 'DM')
          .tag('channel_id', message.channelId)
          .tag('user_id', message.author.id)
          .stringField('message_id', message.id)
          .booleanField('is_command', isCommand)
          .stringField('command_name', commandName)
          .intField('value', 1)
      );
      Logging.trace('Queued message point for InfluxDB');
    } catch (error) {
      Logging.error(`Error saving message to InfluxDB: ${error}`);
    }
  },
});
