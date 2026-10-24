import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { voiceStateChanged } from '../../services/guildLogger';

export default defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    await voiceStateChanged(oldState, newState);
  },
});
