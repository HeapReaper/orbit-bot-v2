import {
  Colors,
  EmbedBuilder,
  Events,
  type GuildMember,
  type PartialGuildMember,
} from 'discord.js';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildLanguage } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { Logging } from '../../lib/logging';

/** Kicks a member the moment they are given the configured forbidden role. */
async function handleMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  const settings = await prisma.roleKickSettings.findFirst({
    where: {
      guildId: newMember.guild.id,
    },
  });

  if (!settings || !settings.enabled || !settings.role || settings.guildId !== newMember.guild.id)
    return;

  if (oldMember.partial) await oldMember.fetch();

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));

  for (const role of addedRoles.values()) {
    if (role.id !== settings.role) continue;

    // Kicking throws when the bot lacks permission or the target outranks it;
    // this handler is detached, so that surfaced as an unhandled rejection.
    if (!newMember.kickable) {
      Logging.warn(
        `RoleKick: cannot kick ${newMember.id} in ${newMember.guild.id} (missing permission or role hierarchy)`
      );
      continue;
    }

    try {
      await newMember.kick('Forbidden role assigned');
    } catch (error) {
      Logging.error(`RoleKick: failed to kick ${newMember.id}: ${error}`);
      continue;
    }

    if (!settings.channel) continue;

    const channel = await newMember.client.channels.fetch(settings.channel).catch(() => null);

    if (!channel?.isSendable()) continue;

    const lang = await getGuildLanguage(newMember.guild.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(t(lang, 'auto_role_kick'))
      .addFields(
        {
          name: t(lang, 'user'),
          value: `<@${newMember.id}>`,
          inline: true,
        },
        {
          name: t(lang, 'role'),
          value: role.name,
          inline: true,
        },
        {
          name: t(lang, 'reason'),
          value: t(lang, 'auto_role_kick'),
        }
      )
      .setTimestamp();

    await channel
      .send({ embeds: [embed] })
      .catch((error) => Logging.error(`RoleKick: could not send notification: ${error}`));
  }
}

export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    await handleMemberUpdate(oldMember, newMember);
  },
});
