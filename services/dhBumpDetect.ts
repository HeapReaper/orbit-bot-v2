import type { Embed, Message, PartialMessage } from 'discord.js';

/** discordhome.com's bump bot */
export const DH_BOT_ID = '826100334534328340';

/**
 * Disboard bumps land in the same channel, so detection stays anchored on the DH
 * bot id first and only then looks at the confirmation wording. The wording is
 * matched over the whole message — content, embeds and components — because DH has
 * moved it between those in the past.
 */
const CONFIRMATION_PATTERN = /bump is live|bump(?:ed)?\s+success|successfully bumped|bump done/i;

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

/**
 * DH replies with a Components V2 message: content and embeds are both empty and every
 * line of the confirmation sits in TextDisplay components nested inside a container and
 * its sections. The walk is structural rather than typed on the component classes so a
 * layout change on DH's side (extra container, section moved) cannot hide the text again.
 */
export function componentText(component: unknown): string {
  if (!component || typeof component !== 'object') return '';

  const node = component as {
    content?: unknown;
    components?: unknown;
    accessory?: unknown;
  };

  const parts: string[] = [];

  if (typeof node.content === 'string') parts.push(node.content);
  if (Array.isArray(node.components)) parts.push(...node.components.map(componentText));
  if (node.accessory) parts.push(componentText(node.accessory));

  return parts.filter(Boolean).join('\n');
}

export function messageText(message: Message | PartialMessage): string {
  return [
    message.content ?? '',
    ...message.embeds.map((embed) => embedText(embed)),
    ...(message.components ?? []).map((component) => componentText(component)),
  ].join('\n');
}

export function isDhBumpMessage(message: Message | PartialMessage): boolean {
  return message.author?.id === DH_BOT_ID;
}

export function isDhBumpConfirmation(message: Message | PartialMessage): boolean {
  if (!isDhBumpMessage(message)) return false;

  return CONFIRMATION_PATTERN.test(messageText(message));
}

/**
 * Who ran /bump. DH replies through an interaction, but it defers first and edits
 * the reply afterwards, and on a message fetched from history the metadata can be
 * missing altogether — hence the mention fallbacks.
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
  if (firstMention && firstMention !== DH_BOT_ID) return firstMention;

  return null;
}
