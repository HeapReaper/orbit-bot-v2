import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { guildEmojisUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildEmojiDelete,
  async execute(emoji) {
    await guildEmojisUpdated(emoji.guild);
  },
});
