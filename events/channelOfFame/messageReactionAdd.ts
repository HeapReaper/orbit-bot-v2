import { type ColorResolvable, EmbedBuilder, Events } from 'discord.js';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { Logging } from '../../lib/logging';

/** Reposts a message to the fame channel once it collects enough of the configured emoji. */
export default defineEvent({
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;

    if (reaction.partial) {
      try {
        reaction = await reaction.fetch();
      } catch (error) {
        Logging.error(`Failed to fetch partial reaction: ${error}`);
        return;
      }
    }

    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;

    const guildId = message.guild?.id;
    if (!guildId) return;

    const redis = getRedisClient();

    // Fetch settings from Redis or DB
    const redisKey = `channel_of_fame:${guildId}`;
    let settings;

    const cachedData = await redis.get(redisKey);
    if (cachedData) {
      settings = JSON.parse(cachedData);
    } else {
      settings = await prisma.channelOfFame.findMany({
        where: { guildId },
      });
      await redis.set(redisKey, JSON.stringify(settings), 'EX', 320);
    }

    if (!settings || settings.length === 0) return;

    for (const setting of settings) {
      if (!setting.enabled) continue;

      if (reaction.emoji.name !== setting.emoji) continue;

      if (!reaction.count) continue;
      if (reaction.count < setting.amount) continue;

      if (!message.content || !message.author) continue;

      // Every reaction past the threshold fires this handler again, so claim
      // the message once, per message and per setting.
      const claimed = await redis.set(
        `channel_of_fame:posted:${setting.id}:${message.id}`,
        '1',
        'EX',
        60 * 60 * 24 * 30,
        'NX'
      );
      if (!claimed) continue;

      const channel = await message.client.channels
        .fetch(setting.channel as string)
        .catch(() => null);
      if (!channel?.isSendable()) continue;

      const guildSettings = await getGuildSettings(guildId);

      const embed: EmbedBuilder = new EmbedBuilder()
        .setTitle(t(guildSettings?.language, 'channel_of_fame_title'))
        .setColor((guildSettings?.primaryColor || '#2F3136') as ColorResolvable)
        .setAuthor({
          name: message.author.displayName || message.author.username,
          iconURL: message.author.displayAvatarURL(),
        })
        .setDescription(`${t(guildSettings.language, 'user')}: <@${message.author.id}>`)
        .addFields({
          name: t(guildSettings.language, 'message'),
          value: `\`\`\`\n${message.content}\n\`\`\``,
        });

      await channel
        .send({
          embeds: [embed],
          allowedMentions: { users: [message.author.id] },
        })
        .catch((error) =>
          Logging.error(`ChannelOfFame: could not post message ${message.id}: ${error}`)
        );
    }
  },
});
