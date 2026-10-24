import { type Client, type ColorResolvable, EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import type { EmbedData, Task } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { getRedisClient } from '../../lib/redis';

function replaceEmbedPlaceholders(
  embed: EmbedData,
  replacements: Record<string, string>
): EmbedData {
  const replaceString = (str?: string) => {
    if (!str) return str;
    let result = str;
    for (const key in replacements) {
      result = result.replaceAll(key, replacements[key]!);
    }
    return result;
  };

  return {
    ...embed,
    color: embed.color,
    title: replaceString(embed.title),
    titleUrl: replaceString(embed.titleUrl),
    description: replaceString(embed.description),
    thumbnail: replaceString(embed.thumbnail),
    image: replaceString(embed.image),
    footer: embed.footer
      ? {
          text: replaceString(embed.footer.text),
          icon: replaceString(embed.footer.icon),
        }
      : undefined,
    author: embed.author
      ? {
          name: replaceString(embed.author.name),
          icon: replaceString(embed.author.icon),
        }
      : undefined,
    // @ts-ignore
    fields: embed.fields?.map((f) => ({
      name: replaceString(f.name),
      value: replaceString(f.value),
      inline: f.inline ?? false,
    })),
  };
}

async function checkBirthdays(client: Client): Promise<void> {
  const redis = getRedisClient();

  let birthdays: any[];

  const cachedData = await redis.get('birthdays');

  if (cachedData) {
    birthdays = JSON.parse(cachedData);
  } else {
    birthdays = await prisma.birthday.findMany();
    await redis.set('birthdays', JSON.stringify(birthdays), 'EX', 120);
  }

  if (birthdays.length <= 0) return;

  // One settings query for every guild that has a birthday on file, instead of
  // one query per birthday row per minute.
  const guildIds = [...new Set(birthdays.map((birthday) => birthday.guildId))];
  const settingsList = await prisma.birthdaySettings.findMany({
    where: { guildId: { in: guildIds } },
  });
  const settingsByGuild = new Map(settingsList.map((setting) => [setting.guildId, setting]));

  // Timezones are resolved per guild and cached for this tick.
  const timeZones = new Map<string, string>();

  for (const birthday of birthdays) {
    try {
      const birthdaySettings = settingsByGuild.get(birthday.guildId);
      if (!birthdaySettings) continue;

      if (!timeZones.has(birthday.guildId)) {
        const guildSettings = await getGuildSettings(birthday.guildId);
        timeZones.set(birthday.guildId, guildSettings?.timezone || 'Europe/Amsterdam');
      }

      // The guild's own timezone decides both which day it is and whether the
      // configured send time has arrived; this used to be hardcoded to
      // Europe/Amsterdam regardless of the guild's settings.
      const zone = timeZones.get(birthday.guildId)!;
      const now: DateTime = DateTime.now().setZone(zone);
      const birthdayDate = DateTime.fromJSDate(new Date(birthday.birthdate)).setZone(zone);

      if (birthdayDate.month !== now.month || birthdayDate.day !== now.day) continue;
      if (birthdaySettings.time !== now.toFormat('HH:mm')) continue;

      const user = await client.users.fetch(`${birthday.userId}`).catch(() => null);
      if (!user) {
        Logging.warn(`Birthday: could not resolve user ${birthday.userId}`);
        continue;
      }

      const channelToSend = await client.channels
        .fetch(birthdaySettings.channel as string)
        .catch(() => null);

      if (!channelToSend?.isSendable()) {
        Logging.warn('I cannot find channel to send birthday notification to!');
        continue;
      }

      const age: number = now.year - birthdayDate.year;
      const replacements = {
        '{user}': `<@${user.id}>`,
        '{age}': `${age}`,
      };

      if (birthdaySettings.messageType === 'text') {
        // replaceAll: `replace` with a string pattern only swaps the first
        // occurrence, so "Happy {age}th, {user}! ({age})" came out half-filled.
        const msgToSend = birthdaySettings.message
          .replaceAll('{age}', `${age}`)
          .replaceAll('{user}', `<@${user.id}>`);

        await channelToSend.send({
          content: msgToSend,
          allowedMentions: { users: [user.id] },
        });
      } else {
        if (!birthdaySettings.embed) continue;
        const embedData = replaceEmbedPlaceholders(
          birthdaySettings.embed as EmbedData,
          replacements
        );

        const embed = new EmbedBuilder();

        if (embedData.color) embed.setColor(embedData.color as ColorResolvable);
        if (embedData.title) embed.setTitle(embedData.title);
        if (embedData.titleUrl) embed.setURL(embedData.titleUrl);
        if (embedData.description) embed.setDescription(embedData.description);
        if (embedData.author?.name)
          embed.setAuthor({
            name: embedData.author.name,
            iconURL: embedData.author.icon || undefined,
          });

        if (embedData.thumbnail) embed.setThumbnail(embedData.thumbnail);
        if (embedData.image) embed.setImage(embedData.image);

        if (embedData.fields?.length) {
          embed.addFields(
            embedData.fields
              .filter((f) => f.name && f.value)
              .map((f) => ({
                name: f.name!,
                value: f.value!,
                inline: f.inline ?? false,
              }))
          );
        }
        if (embedData.footer?.text) {
          embed.setFooter({
            text: embedData.footer.text,
            iconURL: embedData.footer.icon || undefined,
          });
        }

        await channelToSend.send({ embeds: [embed] });
      }
    } catch (error) {
      Logging.error(`Birthday: could not announce birthday ${birthday.id}: ${error}`);
    }
  }
}

/** Posts the configured birthday message at the configured time, in the guild's timezone. */
export default {
  name: 'birthday',
  schedule: '* * * * *',

  async execute(client) {
    await checkBirthdays(client);
  },
} satisfies Task;
