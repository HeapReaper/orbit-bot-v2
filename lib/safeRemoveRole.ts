import { GuildMember } from 'discord.js';

export async function safeRemoveRole(member: GuildMember, roleId: string) {
  const guild = member.guild;

  if (!roleId || roleId === guild.id) return;

  const role = guild.roles.cache.get(roleId);
  if (!role) return;

  if (!member.roles.cache.has(roleId)) return;

  await member.roles.remove(roleId);
}
