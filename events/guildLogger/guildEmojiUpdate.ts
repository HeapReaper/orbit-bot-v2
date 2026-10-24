import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { guildEmojisUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildEmojiUpdate,
  async execute(_oldEmoji, newEmoji) {
    await guildEmojisUpdated(newEmoji.guild);
  },
});
