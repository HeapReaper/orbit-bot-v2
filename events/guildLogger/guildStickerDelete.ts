import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { guildStickersUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildStickerDelete,
  async execute(sticker) {
    if (sticker.guild) await guildStickersUpdated(sticker.guild);
  },
});
