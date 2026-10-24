import {
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { defineEvent } from '../../types';
import { Logging } from '../../lib/logging';
import { getContests } from '../../services/pictureContest';

async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): Promise<void> {
  try {
    if (user.bot) return;

    const message = reaction.partial ? await reaction.message.fetch() : reaction.message;

    if (!message.guild) return;
    if (message.author?.id !== user.id) return;

    const contests = await getContests(message.guild.id);
    if (!contests || contests.length === 0) return;

    const contest = contests.find((c: any) => c.contestChannel === message.channelId);
    if (!contest) return;

    const fullReaction = reaction.partial ? await reaction.fetch() : reaction;
    const isVoteEmoji =
      fullReaction.emoji.name === contest.voteEmoji ||
      fullReaction.emoji.toString() === contest.voteEmoji;
    if (!isVoteEmoji) return;

    await reaction.users.remove(user.id);
    Logging.debug(`Removed self-reaction by ${user.id} on message ${message.id}`);
  } catch (error) {
    Logging.error(`Error handling picture contest reaction: ${error}`);
  }
}

/** Removes votes people cast on their own entry. */
export default defineEvent({
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    await handleReaction(reaction, user);
  },
});
