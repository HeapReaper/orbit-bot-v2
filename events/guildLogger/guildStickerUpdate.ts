import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { guildStickersUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildStickerUpdate,
  async execute(_oldSticker, newSticker) {
    if (newSticker.guild) await guildStickersUpdated(newSticker.guild);
  },
});
