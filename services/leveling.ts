import type { Client } from 'discord.js';
import { Logging } from '../lib/logging';

/** Hard ceiling for the level loop; also stops a corrupt XP value running away. */
const MAX_LEVEL = 1000;

// FIXED? FORMULA (level + 1 instead of +2)
export function getLevelFromXp(xp: number, xpRate: number, curveExponent: number) {
  if (xpRate <= 0) return 0;

  // A flat or shrinking curve never produces a threshold the XP cannot reach,
  // so the loop below would spin forever. Both guards keep that impossible.
  const exponent = Number.isFinite(curveExponent) && curveExponent > 0 ? curveExponent : 1;

  let level = 0;

  while (level < MAX_LEVEL) {
    const xpForNextLevel = 8.196 * Math.pow(level + 1, exponent) + 200;
    if (xp < xpForNextLevel) break;
    level++;
  }

  return level;
}

export async function assignLevelRole(
  client: Client,
  guildId: string,
  userId: string,
  level: number,
  levelingSettings: any
) {
  try {
    const roles = levelingSettings.levelRoles;
    if (!Array.isArray(roles) || roles.length === 0) return;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    if (levelingSettings.roleType === '1-10') {
      if (level >= 1 && level <= roles.length) {
        const roleToAdd = roles[level - 1];
        const roleToRemove = roles[level - 2];

        if (roleToAdd) await member.roles.add(roleToAdd);
        if (roleToRemove) await member.roles.remove(roleToRemove);
      }
    }

    if (levelingSettings.roleType === '5-10') {
      if (level % 5 === 0) {
        const roleToAddIndex = Math.floor(level / 5) - 1;
        const roleToRemoveIndex = Math.floor(level / 5) - 2;

        const roleToAdd = roles[roleToAddIndex];
        const roleToRemove = roles[roleToRemoveIndex];

        if (roleToAdd) await member.roles.add(roleToAdd);
        if (roleToRemove) await member.roles.remove(roleToRemove);
      }
    }
  } catch (error) {
    Logging.error(`Error in [assignLevelRole]: ${error}`);
  }
}
