import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { guildEmojisUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildEmojiCreate,
  async execute(emoji) {
    await guildEmojisUpdated(emoji.guild);
  },
});
