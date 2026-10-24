import {
  type Client,
  type ColorResolvable,
  EmbedBuilder,
  type Message,
  SnowflakeUtil,
  type TextChannel,
} from 'discord.js';
import { DateTime } from 'luxon';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

async function checkPictureContests(client: Client): Promise<void> {
  const now = DateTime.now().setZone('Europe/Amsterdam');

  const contests = await prisma.pictureContestItem.findMany({
    where: { enabled: true },
  });

  for (const contest of contests) {
    try {
      if (!shouldRunToday(contest.schedule, now)) continue;

      const { after, before } = getPeriod(contest.schedule, now);

      const channel = await client.channels.fetch(contest.contestChannel).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        Logging.warn(`Picture contest channel ${contest.contestChannel} not found`);
        continue;
      }

      const messages = await fetchMessagesInPeriod(channel as TextChannel, after, before);
      if (messages.length === 0) continue;

      const winner = findWinner(
        messages,
        contest.voteEmoji,
        contest.voteType,
        contest.requiredVotes
      );
      if (!winner) continue;

      const announceChannel = await client.channels
        .fetch(contest.announceChannel)
        .catch(() => null);
      if (!announceChannel || !announceChannel.isTextBased()) {
        Logging.warn(`Picture contest announce channel ${contest.announceChannel} not found`);
        continue;
      }

      const guildSettings = await getGuildSettings(contest.guildId);
      await announceWinner(announceChannel as TextChannel, winner, contest, guildSettings);
    } catch (error) {
      Logging.error(`Error processing picture contest ${contest.id}: ${error}`);
    }
  }
}

function shouldRunToday(schedule: string, now: DateTime): boolean {
  switch (schedule) {
    case 'end_month':
      return now.day === now.daysInMonth;
    case 'start_month':
      return now.day === 1;
    case 'weekly':
      return now.weekday === 7; // Luxon: 1=Monday, 7=Sunday
    default:
      return false;
  }
}

function getPeriod(schedule: string, now: DateTime): { after: Date; before: Date } {
  switch (schedule) {
    case 'end_month':
      return {
        after: now.startOf('month').toJSDate(),
        before: now.endOf('day').toJSDate(),
      };
    case 'start_month': {
      const lastMonth = now.minus({ months: 1 });
      return {
        after: lastMonth.startOf('month').toJSDate(),
        before: lastMonth.endOf('month').toJSDate(),
      };
    }
    case 'weekly':
      return {
        after: now.minus({ days: 6 }).startOf('day').toJSDate(),
        before: now.endOf('day').toJSDate(),
      };
    default:
      return {
        after: now.startOf('month').toJSDate(),
        before: now.endOf('day').toJSDate(),
      };
  }
}

async function fetchMessagesInPeriod(
  channel: TextChannel,
  after: Date,
  before: Date
): Promise<Message[]> {
  const messages: Message[] = [];

  // Jump straight to the first message at or before `before` instead of
  // paginating from "now" through messages that fall outside the period
  // (e.g. an entire current month for the "start_month" schedule).
  let lastId: string = SnowflakeUtil.generate({ timestamp: before.getTime() }).toString();

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      before: lastId,
    });

    if (fetched.size === 0) break;

    let reachedEnd = false;
    for (const msg of fetched.values()) {
      if (msg.createdAt < after) {
        reachedEnd = true;
        break;
      }
      if (msg.createdAt <= before) {
        const hasImage = msg.attachments.some((a) => a.contentType?.startsWith('image/') ?? false);
        if (hasImage) messages.push(msg);
      }
    }

    if (reachedEnd) break;
    lastId = fetched.last()?.id ?? lastId;
  }

  return messages;
}

function findWinner(
  messages: Message[],
  voteEmoji: string,
  voteType: string,
  requiredVotes: number | null
): Message | null {
  let winner: Message | null = null;
  let bestVotes = -1;

  for (const msg of messages) {
    const reaction = msg.reactions.cache.find(
      (r) => r.emoji.name === voteEmoji || r.emoji.toString() === voteEmoji
    );
    if (!reaction) continue;

    // Subtract 1 only when the bot itself is among the reactors, since
    // the initial react() call can fail (rate limit, missing permission, ...).
    const votes = Math.max(0, reaction.count - (reaction.me ? 1 : 0));

    if (requiredVotes !== null && votes < requiredVotes) continue;

    const isBetter =
      voteType === 'lowest' ? bestVotes === -1 || votes < bestVotes : votes > bestVotes;

    if (isBetter) {
      bestVotes = votes;
      winner = msg;
    }
  }

  return winner;
}

async function announceWinner(
  channel: TextChannel,
  winner: Message,
  contest: any,
  guildSettings: any
): Promise<void> {
  const reaction = winner.reactions.cache.find(
    (r) => r.emoji.name === contest.voteEmoji || r.emoji.toString() === contest.voteEmoji
  );
  const votes = reaction ? Math.max(0, reaction.count - (reaction.me ? 1 : 0)) : 0;

  const image = winner.attachments.find((a) => a.contentType?.startsWith('image/') ?? false);

  const embed = new EmbedBuilder()
    .setTitle(t(guildSettings?.language, 'picture_contest_winner_title', { contest: contest.name }))
    .setColor((guildSettings?.primaryColor as ColorResolvable) ?? '#2F3136')
    .setDescription(
      t(guildSettings?.language, 'picture_contest_winner_description', {
        user: winner.author.id,
        votes: votes.toString(),
        url: winner.url,
      })
    )
    .setAuthor({
      name: winner.author.displayName || winner.author.username,
      iconURL: winner.author.displayAvatarURL(),
    })
    .setTimestamp();

  if (image) embed.setImage(image.url);

  await channel.send({
    embeds: [embed],
    allowedMentions: { users: [winner.author.id] },
  });
}

/** Announces the winning picture of every contest whose period ends today. */
export default {
  name: 'picture-contest',
  schedule: '0 20 * * *',
  timezone: 'Europe/Amsterdam',

  async execute(client) {
    await checkPictureContests(client);
  },
} satisfies Task;
