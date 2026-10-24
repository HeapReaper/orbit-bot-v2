import { Events, type Message } from 'discord.js';
import { defineEvent } from '../../types';
import { runAI } from '../../lib/ai';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

/** Parsing a reminder costs an LLM call, so cap it per user. */
const AI_COOLDOWN_SECONDS = 30;

async function addReminder(message: Message) {
  const guildSettings = message.guildId ? await getGuildSettings(message.guildId) : null;

  const response = await runAI(
    message.content,
    'Give me only the date, time and what the reminder is for, seperated by one spaces'
  );

  if (response.status === 'success') {
    const aiText: string = response.data.response.trim();

    // expected format: "DD-MM HH:mm <message>"
    const parts = aiText.split(' ');
    if (parts.length < 3) {
      await message.reply(t(guildSettings?.language, 'timekeeper_ai_format_error'));
      return;
    }

    const [day = NaN, month = NaN] = parts[0]!.split('-').map(Number);
    const [hour = NaN, minute = NaN] = parts[1]!.split(':').map(Number);
    const reminderMessage = parts.slice(2).join(' ');

    if ([day, month, hour, minute].some(isNaN)) {
      await message.reply(t(guildSettings?.language, 'timekeeper_ai_parse_error'));
      return;
    }

    const now = new Date();
    const remindAt = new Date(now.getFullYear(), month - 1, day, hour, minute, 0, 0);

    // If date is passed, use next year
    if (remindAt < now) {
      remindAt.setFullYear(now.getFullYear() + 1);
    }

    await prisma.reminder.create({
      data: {
        message: reminderMessage,
        remindAt,
        userId: message.author.id,
        channelId: message.channelId,
        guildId: message.guildId,
      },
    });

    const timestamp = Math.floor(remindAt.getTime() / 1000);
    await message.reply(
      t(guildSettings?.language, 'timekeeper_ai_reminder_set', {
        timestamp: timestamp.toString(),
        message: reminderMessage,
      })
    );
  } else {
    Logging.error(`Error saving reminder with ai: ${response.error}`);
    await message.reply(t(guildSettings?.language, 'timekeeper_ai_generic_error'));
  }
}

/** "@Orbit remind me ..." creates a reminder, parsed by the AI. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (!message.mentions.users.has(message.client.user.id)) return;
    if (!message.content.includes(`herinner`) && !message.content.includes(`remind`)) return;

    const allowed = await getRedisClient()
      .set(`timekeeper:ai:${message.author.id}`, '1', 'EX', AI_COOLDOWN_SECONDS, 'NX')
      .catch(() => null);

    if (!allowed) return;

    await addReminder(message);
  },
});
