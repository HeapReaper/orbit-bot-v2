import { TextChannel, EmbedBuilder, ColorResolvable, Message } from 'discord.js';
import type { EmbedData } from '../types';

/**
 * Send an embed to a channel with optional replacements.
 * @param channel Discord TextChannel
 * @param embedData Embed structure
 * @param replacements Array of tuples: [placeholder, value]
 * @param plainReplacements Replacements for the title, author, footer and field names. Discord never
 *   renders mentions there, so pass plain text (e.g. a username) instead. Defaults to `replacements`.
 * @returns The sent message, so callers can store or delete it later.
 */
export async function sendEmbed(
  channel: TextChannel,
  embedData: EmbedData,
  replacements: [string, string][] = [],
  plainReplacements: [string, string][] = replacements
): Promise<Message> {
  const applyReplacements = (text: string, pairs: [string, string][]) => {
    let result = text;
    for (const [key, value] of pairs) {
      result = result.split(key).join(value);
    }
    return result;
  };
  const replaceAll = (text: string) => applyReplacements(text, replacements);
  const replacePlain = (text: string) => applyReplacements(text, plainReplacements);

  const e = new EmbedBuilder();

  if (embedData.color) e.setColor((embedData.color as ColorResolvable) ?? '#2F3136');
  if (embedData.title) e.setTitle(replacePlain(embedData.title));
  if (embedData.titleUrl) e.setURL(replaceAll(embedData.titleUrl));
  if (embedData.description) e.setDescription(replaceAll(embedData.description));
  if (embedData.author?.name) {
    e.setAuthor({
      name: replacePlain(embedData.author.name),
      iconURL: embedData.author.icon || undefined,
    });
  }
  if (embedData.thumbnail) e.setThumbnail(embedData.thumbnail);
  if (embedData.image) e.setImage(embedData.image);
  if (embedData.footer?.text || embedData.footer?.icon) {
    e.setFooter({
      text: embedData.footer?.text ? replacePlain(embedData.footer.text) : '',
      iconURL: embedData.footer?.icon || undefined,
    });
  }
  if (embedData.fields?.length) {
    e.addFields(
      embedData.fields
        .filter((f) => f.name && f.value)
        .map((f) => ({
          name: replacePlain(f.name),
          value: replaceAll(f.value),
          inline: f.inline ?? false,
        }))
    );
  }

  return channel.send({ embeds: [e] });
}
