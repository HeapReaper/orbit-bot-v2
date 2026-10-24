import type { Embed, Message, PartialMessage } from 'discord.js';

/** disboard.org's bump bot */
export const DISBOARD_BOT_ID = '302050872383242240';

/**
 * Disboard localises its bump reply per server language, so a single English phrase
 * is not enough. Detection is anchored on the bot id first, then on a success phrase,
 * and cooldown replies ("please wait another 43 minutes") are explicitly excluded —
 * those carry interaction metadata too and would otherwise read as a fresh bump.
 */
const SUCCESS_PATTERN =
  /bump done|bump gedaan|bump erfolgreich|bump effectué|bump realizado|bumpeado|bump reso|表示順をアップしました|bumped!/i;

const COOLDOWN_PATTERN =
  /please wait|wait another|try again|nog\s+\d+\s*min|noch\s+\d+\s*min|encore\s+\d+\s*min|cooldown|minutes? (?:left|remaining)/i;

export function embedText(embed: Embed | undefined | null): string {
  if (!embed) return '';

  return [
    embed.title ?? '',
    embed.description ?? '',
    embed.author?.name ?? '',
    embed.footer?.text ?? '',
    ...embed.fields.map((field) => `${field.name}\n${field.value}`),
  ].join('\n');
}

export function messageText(message: Message | PartialMessage): string {
  return [message.content ?? '', ...message.embeds.map((embed) => embedText(embed))].join('\n');
}

export function isDisboardMessage(message: Message | PartialMessage): boolean {
  return message.author?.id === DISBOARD_BOT_ID;
}

export function isBumpConfirmation(message: Message | PartialMessage): boolean {
  if (!isDisboardMessage(message)) return false;

  const text = messageText(message);

  if (COOLDOWN_PATTERN.test(text)) return false;

  return SUCCESS_PATTERN.test(text);
}

/**
 * Who ran /bump. Disboard replies through an interaction, but the metadata can be
 * missing on an edited reply or on a message fetched back out of channel history —
 * hence the mention fallbacks.
 */
export function extractBumperId(message: Message | PartialMessage): string | null {
  const fromMetadata = message.interactionMetadata?.user?.id;
  if (fromMetadata) return fromMetadata;

  // Legacy payload field, still present on older/edited messages
  const fromLegacy = (message as unknown as { interaction?: { user?: { id: string } } }).interaction
    ?.user?.id;
  if (fromLegacy) return fromLegacy;

  const mentioned = messageText(message).match(/<@!?(\d{17,20})>/);
  if (mentioned?.[1]) return mentioned[1];

  const firstMention = message.mentions?.users?.first()?.id;
  if (firstMention && firstMention !== DISBOARD_BOT_ID) return firstMention;

  return null;
}
