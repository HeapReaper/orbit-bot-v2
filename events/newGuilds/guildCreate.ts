import { Events } from 'discord.js';
import { addDays } from 'date-fns';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';

const TRIAL_DAYS = 7;

/** Gives a guild that adds the bot for the first time a premium trial. */
export default defineEvent({
  name: Events.GuildCreate,
  async execute(guild) {
    // A guild that removes and re-adds the bot already has a row; only a
    // genuinely new guild gets a trial.
    await prisma.premiumGuild.upsert({
      where: { guildId: guild.id },
      update: {},
      create: {
        guildId: guild.id,
        premium: true,
        trialEndsAt: addDays(new Date(), TRIAL_DAYS),
      },
    });
  },
});
