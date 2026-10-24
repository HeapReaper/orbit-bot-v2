import type { Client } from 'discord.js';
import type { Task } from '../../types';
import { Logging } from '../../lib/logging';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { runAI } from '../../lib/ai';

const DEFAULT_QOTD_PROMPT =
  'Generate a fun and engaging question of the day for a Discord community. Make it open-ended and thought-provoking. Only respond with the question itself, no extra text.';

const QOTD_SYSTEM =
  'Respond with only the question, nothing else — no introduction, no explanation, no quotes.';

// How many recent questions to remember and feed back to the AI to avoid repeats
const RECENT_QUESTIONS_LIMIT = 30;

async function generateQotd(aiPrompt: string, recentQuestions: string[]): Promise<string | null> {
  const basePrompt = aiPrompt.trim() || DEFAULT_QOTD_PROMPT;

  let prompt = basePrompt;
  if (recentQuestions.length > 0) {
    const list = recentQuestions.map((q) => `- ${q}`).join('\n');
    prompt +=
      `\n\nDo NOT repeat or rephrase any of these previously asked questions, ` +
      `and avoid the same topics and sentence structure:\n${list}`;
  }

  const result = await runAI(prompt, QOTD_SYSTEM);

  return result.status === 'success' ? result.data.response : null;
}

const BIWEEKLY_MS = 14 * 24 * 60 * 60 * 1000;

async function task(client: Client) {
  Logging.trace('Running QOTD task');

  const settings = await prisma.qotdSettings.findMany({
    where: { enabled: true },
  });

  const now = new Date();

  // Each guild is evaluated in its own timezone; this used to be hardcoded to
  // Europe/Amsterdam, so a schedule of 09:00 fired at 09:00 CET everywhere.
  const timeZones = new Map<string, string>();

  const localNow = (timeZone: string): { time: string; dayShort: string; date: number } => {
    try {
      return {
        time: new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone,
        }).format(now),
        dayShort: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone })
          .format(now)
          .replace('.', ''),
        date: Number(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone }).format(now)),
      };
    } catch {
      Logging.warn(`Qotd: unknown timezone "${timeZone}", falling back to UTC`);
      return localNow('UTC');
    }
  };

  for (const setting of settings) {
    // Channel must be configured
    if (!setting.channel) continue;

    if (!timeZones.has(setting.guildId)) {
      const guildSettings = await getGuildSettings(setting.guildId);
      timeZones.set(setting.guildId, guildSettings?.timezone || 'Europe/Amsterdam');
    }

    const {
      time: currentTime,
      dayShort: currentDayShort,
      date: currentDate,
    } = localNow(timeZones.get(setting.guildId)!);

    // Time must match exactly
    if (setting.time !== currentTime) continue;

    // Prevent double send in same minute
    if (setting.lastSentAt) {
      const diff = now.getTime() - setting.lastSentAt.getTime();
      if (diff < 60 * 1000) continue;
    }

    const days: string[] = Array.isArray(setting.days) ? (setting.days as string[]) : [];

    // === SCHEDULE HANDLING ===
    switch (setting.scheduleType) {
      case 'daily':
        break;

      case 'weekly':
        if (days.length > 0 && !days.includes(currentDayShort)) {
          continue;
        }
        break;

      case 'biweekly':
        if (days.length > 0 && !days.includes(currentDayShort)) {
          continue;
        }

        if (setting.lastSentAt) {
          const diff = now.getTime() - setting.lastSentAt.getTime();
          if (diff < BIWEEKLY_MS) {
            continue;
          }
        }
        break;

      case 'monthly':
        if (!setting.monthlyDate || setting.monthlyDate !== currentDate) {
          continue;
        }

        // Prevent multiple sends in same month
        if (
          setting.lastSentAt &&
          setting.lastSentAt.getMonth() === now.getMonth() &&
          setting.lastSentAt.getFullYear() === now.getFullYear()
        ) {
          continue;
        }
        break;

      default:
        Logging.error(`Unknown scheduleType for QOTD guild ${setting.guildId}`);
        continue;
    }

    // === FETCH CHANNEL ===
    const channel = await client.channels.fetch(setting.channel).catch(() => null);

    if (!channel?.isSendable()) continue;

    // === GENERATE QUESTION ===
    let recentQuestions: string[] = [];
    if (Array.isArray(setting.recentQuestions)) {
      recentQuestions = (setting.recentQuestions as unknown[]).filter(
        (q): q is string => typeof q === 'string'
      );
    }

    const question = await generateQotd(setting.aiPrompt, recentQuestions);

    if (!question) {
      Logging.error(`Failed to generate QOTD for guild ${setting.guildId}`);
      continue;
    }

    try {
      await channel.send({ content: question });

      // Keep only the most recent questions so the AI can avoid repeating them
      const updatedRecent = [...recentQuestions, question].slice(-RECENT_QUESTIONS_LIMIT);

      await prisma.qotdSettings.update({
        where: { id: setting.id },
        data: { lastSentAt: now, recentQuestions: updatedRecent },
      });

      Logging.info(
        `Sent QOTD to guild ${setting.guildId} channel ${channel.id} (${currentDayShort} ${currentTime})`
      );
    } catch (err) {
      Logging.error(`Failed to send QOTD to guild ${setting.guildId}: ${err}`);
    }
  }
}

/** Posts an AI generated question of the day on the configured schedule. */
export default {
  name: 'qotd',
  schedule: '* * * * *',

  async execute(client) {
    await task(client);
  },
} satisfies Task;
