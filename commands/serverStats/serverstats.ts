import {
  type CategoryChannel,
  ChannelType,
  type ChatInputCommandInteraction,
  type Guild,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type VoiceChannel,
} from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { collectCounts } from '../../services/serverStats';

async function setup(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const guild = interaction.guild;
  const guildId = guild.id;

  const guildSettings = await getGuildSettings(guildId);
  const enabled = interaction.options.getBoolean('enabled', true);

  const options = {
    members: interaction.options.getBoolean('members'),
    boosts: interaction.options.getBoolean('boosts'),
    bots: interaction.options.getBoolean('bots'),
    online: interaction.options.getBoolean('online'),
    channels: interaction.options.getBoolean('channels'),
    roles: interaction.options.getBoolean('roles'),
  };

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Fetch or create DB record
  const stats = await prisma.serverStats.upsert({
    where: { guildId },
    update: {},
    create: { guildId },
  });

  /**
   * Ensure "Server Stats" category exists & is on top
   */
  const category = await getOrCreateCategory(guild, guildSettings);

  /**
   * Create or delete stat channel
   */
  const handleStat = async (
    enabled: boolean | null,
    channelId: string | null
  ): Promise<string | null> => {
    if (enabled === null) return channelId;

    // CREATE
    if (enabled && !channelId) {
      const channel = await guild.channels.create({
        name: t(guildSettings?.language, 'serverstats_channel_loading'),
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionFlagsBits.Connect],
            allow: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: guild.roles.cache.find((r) =>
              r.permissions.has(PermissionFlagsBits.Administrator)
            )!,
            allow: [PermissionFlagsBits.Connect],
          },
        ],
      });

      return channel.id;
    }

    // DELETE
    if (!enabled && channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (channel) await channel.delete();
      return null;
    }

    return channelId;
  };

  const updatedData = {
    memberCountChannelId: await handleStat(options.members, stats.memberCountChannelId),
    boostCountChannelId: await handleStat(options.boosts, stats.boostCountChannelId),
    botCountChannelId: await handleStat(options.bots, stats.botCountChannelId),
    onlineMemberCountChannelId: await handleStat(options.online, stats.onlineMemberCountChannelId),
    channelCountChannelId: await handleStat(options.channels, stats.channelCountChannelId),
    rolesCountChannelId: await handleStat(options.roles, stats.rolesCountChannelId),
  };

  // GLOBAL DISABLE
  if (!enabled) {
    for (const id of Object.values(updatedData)) {
      if (!id) continue;
      const channel = guild.channels.cache.get(id);
      if (channel) await channel.delete();
    }

    await prisma.serverStats.update({
      where: { guildId },
      data: {
        memberCountChannelId: null,
        boostCountChannelId: null,
        botCountChannelId: null,
        onlineMemberCountChannelId: null,
        channelCountChannelId: null,
        rolesCountChannelId: null,
      },
    });

    await interaction.editReply(t(guildSettings?.language, 'serverstats_disabled'));
    return;
  }

  // Save DB
  await prisma.serverStats.update({
    where: { guildId },
    data: updatedData,
  });

  // Update names
  await updateChannelNames(guild, updatedData, guildSettings);

  await interaction.editReply(t(guildSettings?.language, 'serverstats_updated'));
}

/**
 * Create or fetch Server Stats category (always on top)
 */
async function getOrCreateCategory(guild: Guild, guildSettings: any): Promise<CategoryChannel> {
  const categoryName = t(guildSettings?.language, 'serverstats_category_name');

  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === categoryName
  ) as CategoryChannel | undefined;

  if (!category) {
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
    });
  }

  await category.setPosition(0);
  return category;
}

/**
 * Update channel names with emoji + current stats
 */
async function updateChannelNames(
  guild: Guild,
  stats: Record<string, string | null>,
  guildSettings: any
) {
  const { memberCount, botCount, onlineCount, channelCount, rolesCount, boostCount } =
    await collectCounts(guild);

  const rename = async (id: string | null, name: string) => {
    if (!id) return;
    const channel = guild.channels.cache.get(id) as VoiceChannel;
    if (channel) {
      await channel.setName(name);
    }
  };

  await rename(
    stats.memberCountChannelId,
    t(guildSettings?.language, 'serverstats_channel_members', { count: memberCount.toString() })
  );
  await rename(
    stats.boostCountChannelId,
    t(guildSettings?.language, 'serverstats_channel_boosts', { count: boostCount.toString() })
  );
  await rename(
    stats.botCountChannelId,
    t(guildSettings?.language, 'serverstats_channel_bots', { count: botCount.toString() })
  );
  await rename(
    stats.onlineMemberCountChannelId,
    t(guildSettings?.language, 'serverstats_channel_online', { count: onlineCount.toString() })
  );
  await rename(
    stats.channelCountChannelId,
    t(guildSettings?.language, 'serverstats_channel_channels', { count: channelCount.toString() })
  );
  await rename(
    stats.rolesCountChannelId,
    t(guildSettings?.language, 'serverstats_channel_roles', { count: rolesCount.toString() })
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('Configure server statistics counters')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Enable or disable server stat counters')
        .addBooleanOption((o) =>
          o
            .setName('enabled')
            .setDescription('Enable or disable server stats globally')
            .setRequired(true)
        )
        .addBooleanOption((o) => o.setName('members').setDescription('Enable member count'))
        .addBooleanOption((o) => o.setName('boosts').setDescription('Enable boost count'))
        .addBooleanOption((o) => o.setName('bots').setDescription('Enable bot count'))
        .addBooleanOption((o) => o.setName('online').setDescription('Enable online member count'))
        .addBooleanOption((o) => o.setName('channels').setDescription('Enable channel count'))
        .addBooleanOption((o) => o.setName('roles').setDescription('Enable roles count'))
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand(false) === 'setup') {
      await setup(interaction);
    }
  },
} satisfies Command;
