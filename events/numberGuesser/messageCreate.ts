import { type ColorResolvable, EmbedBuilder, Events, type Message } from 'discord.js';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

// key: `${gameId}_${userId}` → last guess timestamp (ms)
const cooldownMap = new Map<string, number>();

/**
 * Entries used to be dropped only when a game was won, so an abandoned or
 * stopped game leaked one entry per player forever. Anything older than a day
 * is past every possible cooldown and can go.
 */
const COOLDOWN_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

function pruneCooldowns(now: number): void {
  for (const [key, timestamp] of cooldownMap) {
    if (now - timestamp > COOLDOWN_ENTRY_TTL_MS) cooldownMap.delete(key);
  }
}

async function handleGuess(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  // The whole message must be the number. `parseInt` alone happily read
  // "5 minutes late" as a guess of 5.
  const content = message.content.trim();
  if (!/^-?\d{1,15}$/.test(content)) return;

  const guess = Number.parseInt(content, 10);

  const game = await prisma.numberGuesserGame.findFirst({
    where: { channelId: message.channelId, active: true },
  });

  if (!game) return;

  const guildSettings = await getGuildSettings(message.guild.id);

  // `<=` excluded the lower bound, while the secret number is drawn from
  // [min, max] — so a game with the answer equal to `min` was unwinnable.
  if (guess < game.minNumber || guess > game.maxNumber) {
    await message.reply(
      t(guildSettings?.language, 'numberguesser_out_of_range', {
        min: game.minNumber.toString(),
        max: game.maxNumber.toString(),
      })
    );
    return;
  }

  if (game.cooldownSeconds > 0) {
    const key = `${game.id}_${message.author.id}`;
    const lastGuess = cooldownMap.get(key);
    const now = Date.now();

    if (lastGuess !== undefined) {
      const elapsed = (now - lastGuess) / 1000;
      const remaining = game.cooldownSeconds - elapsed;

      if (remaining > 0) {
        await message.reply(
          t(guildSettings?.language, 'numberguesser_cooldown_wait', {
            user: message.author.id,
            seconds: Math.ceil(remaining).toString(),
          })
        );
        return;
      }
    }

    cooldownMap.set(key, now);
    pruneCooldowns(now);
  }

  // Atomic increment: reading the count and writing it back lost guesses
  // whenever two people answered at the same moment.
  const updated = await prisma.numberGuesserGame.update({
    where: { id: game.id },
    data: { guessCount: { increment: 1 } },
  });
  const newGuessCount = updated.guessCount;

  if (guess === game.secretNumber) {
    // Only the first correct guess wins: the conditional `active: true` makes
    // a simultaneous second winner a no-op instead of overwriting the first.
    const claimed = await prisma.numberGuesserGame.updateMany({
      where: { id: game.id, active: true },
      data: { active: false, winnerId: message.author.id, endedAt: new Date() },
    });

    if (claimed.count === 0) return;

    // Clean up cooldown entries for this game
    for (const key of cooldownMap.keys()) {
      if (key.startsWith(`${game.id}_`)) cooldownMap.delete(key);
    }

    const embed = new EmbedBuilder()
      .setColor('Green' as ColorResolvable)
      .setTitle(t(guildSettings?.language, 'numberguesser_winner_title'))
      .setDescription(
        t(guildSettings?.language, 'numberguesser_winner_description', {
          user: message.author.id,
          number: game.secretNumber.toString(),
          count: newGuessCount.toString(),
        })
      );

    await message.reply({ embeds: [embed] });
  } else {
    await message.reply(
      t(guildSettings?.language, 'numberguesser_incorrect', { user: message.author.id })
    );
  }
}

/** Checks guesses in channels with an active number guessing game. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    await handleGuess(message);
  },
});
