import type { Client } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';
import { getModerationConfig } from '../../services/moderation';

/** Lifts mutes whose duration has passed. */
async function expireMutes(client: Client<true>): Promise<void> {
  const expired = await prisma.moderationCase.findMany({
    where: {
      active: true,
      action: { in: ['mute', 'timeout'] },
      expiresAt: { not: null, lte: new Date() },
    },
    take: 100,
  });

  for (const item of expired) {
    try {
      // A timeout expires on Discord's side, only the mute role has to go
      if (item.action === 'mute') {
        await removeMuteRole(client, item.guildId, item.userId);
      }

      await prisma.moderationCase.update({
        where: { id: item.id },
        data: { active: false },
      });
    } catch (error) {
      Logging.error(`[Moderation] Could not expire case ${item.id}: ${error}`);
    }
  }
}

async function removeMuteRole(
  client: Client<true>,
  guildId: string,
  userId: string
): Promise<void> {
  const config = await getModerationConfig(guildId);
  if (!config?.muteRole) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const member = await guild.members.fetch(userId).catch(() => null);
  // A member who left keeps the case closed, the role is gone with them
  if (!member) return;

  if (!member.roles.cache.has(config.muteRole)) return;

  await member.roles
    .remove(config.muteRole, 'Mute expired')
    .catch((error) => Logging.error(`[Moderation] Could not remove mute role: ${error}`));
}

/**
 * Expires warnings so they stop counting toward the escalation ladder.
 * Guilds with warnExpiryDays set to 0 store no expiry and are skipped.
 */
async function expireWarnings(): Promise<void> {
  const { count } = await prisma.moderationCase.updateMany({
    where: {
      active: true,
      action: 'warn',
      expiresAt: { not: null, lte: new Date() },
    },
    data: { active: false },
  });

  if (count > 0) Logging.trace(`[Moderation] Expired ${count} warning(s)`);
}

export default {
  name: 'moderation-expiry',
  schedule: '* * * * *',

  async execute(client) {
    await expireMutes(client);
    await expireWarnings();
  },
} satisfies Task;
