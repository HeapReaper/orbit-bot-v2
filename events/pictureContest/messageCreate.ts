import { Events, type Message } from 'discord.js';
import { defineEvent } from '../../types';
import { Logging } from '../../lib/logging';
import { getContests } from '../../services/pictureContest';

async function handleMessage(message: Message): Promise<void> {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    const contests = await getContests(message.guild.id);
    if (!contests || contests.length === 0) return;

    const contest = contests.find((c: any) => c.contestChannel === message.channelId);
    if (!contest) return;

    const hasImage = message.attachments.some((a) => a.contentType?.startsWith('image/') ?? false);

    if (!hasImage) {
      await message.delete();
      return;
    }

    try {
      await message.react(contest.voteEmoji);
    } catch (error) {
      Logging.warn(`Failed to react to picture contest message: ${error}`);
    }
  } catch (error) {
    Logging.error(`Error handling picture contest message: ${error}`);
  }
}

/** Only images are allowed in a contest channel; each entry gets the vote emoji. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    await handleMessage(message);
  },
});
