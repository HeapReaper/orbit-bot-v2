import { Colors, EmbedBuilder, Events, type Guild, type GuildMember } from 'discord.js';
import { defineEvent } from '../../types';
import { getRedisClient } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { t } from '../../lib/i18n';
import { Logging } from '../../lib/logging';
import { getGuildSettings } from '../../lib/guildSettings';

/** Works out which invite a new member used and logs the join with it. */
async function handleMemberJoin(member: GuildMember) {
  const redis = getRedisClient();
  const guild: Guild = member.guild;

  // Check if feature is enabled
  const guildInviteSettings = await prisma.guildInviteSettings.findFirst({
    where: {
      guildId: guild.id,
      enabled: true,
    },
  });

  // Load previous cached invites
  const cachedJSON = await redis.get(`invites:${guild.id}`);
  const cachedInvites = cachedJSON ? JSON.parse(cachedJSON) : {};

  // Fetch current Discord invites
  const newInvites = await guild.invites.fetch().catch(() => null);
  if (!newInvites) return;

  let usedInvite = null;

  for (const invite of newInvites.values()) {
    const oldUses = cachedInvites[invite.code] ?? 0;
    const newUses = invite.uses ?? 0;

    if (newUses > oldUses) {
      usedInvite = invite;
      break;
    }
  }

  // Save updated invite snapshot
  const updatedSnapshot: Record<string, number> = {};
  newInvites.forEach((invite) => {
    updatedSnapshot[invite.code] = invite.uses ?? 0;
  });

  await redis.set(`invites:${guild.id}`, JSON.stringify(updatedSnapshot));

  // If no invite changed (fallback)
  if (!usedInvite) {
    Logging.debug(`InviteTracker: could not determine invite used by ${member.user.tag}`);
    return;
  }

  const inviteEntry = await prisma.inviteTrackerInvite.findFirst({
    where: {
      guildId: guild.id,
      inviteCode: usedInvite.code,
    },
  });

  const label =
    inviteEntry && inviteEntry.inviteType && inviteEntry.inviteType.trim() !== ''
      ? inviteEntry.inviteType
      : usedInvite.code;

  // Log it to server
  const loggingSettings = await prisma.loggingSettings.findFirst({
    where: {
      guildId: member.guild.id,
    },
  });

  if (!loggingSettings || !loggingSettings.events) return;

  if (!loggingSettings.enabled) return;

  // `events` is a JSON column holding an array of enabled event names.
  // `Array(x)[0]` was a no-op wrapper that happened to work; check it directly.
  const enabledEvents = Array.isArray(loggingSettings.events)
    ? (loggingSettings.events as unknown[])
    : [];
  if (!enabledEvents.includes('member_join')) return;

  const guildSettings = await getGuildSettings(member.guild.id);
  let lang = '';
  if (guildSettings) {
    lang = guildSettings.language ? guildSettings.language : 'en';
  }

  const embed: EmbedBuilder = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(t(lang, 'member_join'))
    .addFields(
      { name: t(lang, 'user'), value: `<@${member.id}>` },
      {
        name: t(lang, 'account_created'),
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
      }
    )
    .setTimestamp();

  if (guildInviteSettings && guildInviteSettings.enabled) {
    embed.addFields({ name: t(lang, 'invite'), value: `${label}` });
  }

  const logChannel = await member.client.channels
    .fetch(loggingSettings.channel as string)
    .catch(() => null);

  if (!logChannel?.isSendable()) return;

  await logChannel
    .send({ embeds: [embed] })
    .catch((error) => Logging.error(`InviteTracker: could not log member join: ${error}`));
}

export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(member) {
    await handleMemberJoin(member);
  },
});
