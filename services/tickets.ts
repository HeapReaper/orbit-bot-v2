import {
  ActionRowBuilder,
  type ButtonInteraction,
  type CategoryChannel,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  MessageFlags,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Logging } from '../lib/logging';
import { prisma } from '../lib/prisma';
import { GuildLogger } from '../lib/guildLog';
import { getGuildSettings } from '../lib/guildSettings';
import { t } from '../lib/i18n';

const REQUIRED_TICKET_CATEGORY_PERMISSIONS: { flag: bigint; label: string }[] = [
  { flag: PermissionFlagsBits.ViewChannel, label: 'View Channel' },
  { flag: PermissionFlagsBits.ManageChannels, label: 'Manage Channels' },
];

interface PermissionCheckResult {
  ok: boolean;
  missing: string[];
}

/**
 * Checks that the bot has the permissions required to create a ticket channel
 * inside `category`. If something is missing, it first tries to fix it by
 * granting the bot an explicit category-level overwrite before failing.
 */
async function ensureTicketCategoryPermissions(
  category: CategoryChannel,
  guild: Guild
): Promise<PermissionCheckResult> {
  const botMember = guild.members.me ?? (await guild.members.fetchMe());

  const getMissing = (): { flag: bigint; label: string }[] => {
    const perms = category.permissionsFor(botMember);
    if (!perms) return REQUIRED_TICKET_CATEGORY_PERMISSIONS;
    return REQUIRED_TICKET_CATEGORY_PERMISSIONS.filter((p) => !perms.has(p.flag));
  };

  let missing = getMissing();
  if (missing.length === 0) return { ok: true, missing: [] };

  Logging.info(
    `Ticket category ${category.id} is missing permissions [${missing
      .map((p) => p.label)
      .join(', ')}] for the bot, attempting to fix the category overwrite`
  );

  try {
    await category.permissionOverwrites.edit(botMember, {
      ViewChannel: true,
      ManageChannels: true,
    });
  } catch (error) {
    Logging.error(`Could not fix permissions on ticket category ${category.id}: ${error}`);
    return { ok: false, missing: missing.map((p) => p.label) };
  }

  missing = getMissing();
  return { ok: missing.length === 0, missing: missing.map((p) => p.label) };
}

/**
 * Turns a display name into a valid, unique-ish Discord channel name.
 */
function sanitizeChannelName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return (sanitized || 'ticket').slice(0, 90);
}

export async function showEmbedModal(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const guildSettings = await getGuildSettings(interaction.guild.id);

  const modal = new ModalBuilder()
    .setCustomId('ticket_embed_modal')
    .setTitle(t(guildSettings?.language, 'ticket_modal_title'));

  const titleInput = new TextInputBuilder()
    .setCustomId('ticket_embed_title')
    .setLabel(t(guildSettings?.language, 'ticket_modal_label_title'))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('ticket_embed_description')
    .setLabel(t(guildSettings?.language, 'ticket_modal_label_description'))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);

  const buttonTextInput = new TextInputBuilder()
    .setCustomId('ticket_embed_button_text')
    .setLabel(t(guildSettings?.language, 'ticket_modal_label_button_text'))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(buttonTextInput)
  );

  await interaction.showModal(modal);
}

/**
 * Resolves `id` to a category channel. Returns `null` if the channel
 * doesn't exist (any more) or isn't actually a category.
 */
export async function fetchTicketCategory(
  client: Client,
  id: string
): Promise<CategoryChannel | null> {
  const channel = await client.channels.fetch(id).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildCategory) return null;

  return channel;
}

/**
 * Finds an already open ticket channel for `userId` in either of the
 * guild's configured ticket categories, so a user can only have one open
 * ticket at a time.
 */
export async function findOpenTicket(guild: Guild, userId: string): Promise<TextChannel | null> {
  const data = await prisma.ticketSettings.findFirst({ where: { guildId: guild.id } });
  const categoryIds = [data?.channel, data?.channelConf].filter((id): id is string => !!id);

  if (categoryIds.length === 0) return null;

  const channels = await guild.channels.fetch();

  const existing = channels.find((channel) => {
    if (!channel || channel.type !== ChannelType.GuildText) return false;
    if (!channel.parentId || !categoryIds.includes(channel.parentId)) return false;

    return channel.permissionOverwrites.cache.some(
      (overwrite) => overwrite.type === OverwriteType.Member && overwrite.id === userId
    );
  });

  return (existing as TextChannel) ?? null;
}

/**
 * Creates a private ticket channel inside `ticketCategory` for the user
 * behind `interaction`, and grants them access to it.
 */
export async function createTicket(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  ticketCategory: CategoryChannel
): Promise<void> {
  if (!interaction.guild) return;

  const guildSettings = await getGuildSettings(interaction.guild.id);

  if (!ticketCategory) {
    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_channel_not_configured'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existingTicket = await findOpenTicket(interaction.guild, interaction.user.id);

  if (existingTicket) {
    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_already_open', { url: existingTicket.url }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const permissionCheck = await ensureTicketCategoryPermissions(ticketCategory, interaction.guild);

  if (!permissionCheck.ok) {
    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_missing_permissions', {
        permissions: permissionCheck.missing.join(', '),
      }),
      flags: MessageFlags.Ephemeral,
    });
    GuildLogger.error(
      interaction.guild.id,
      `Missing permissions in ticket category ${ticketCategory.id}: ${permissionCheck.missing.join(', ')}`
    );
    return;
  }

  const reason: string | null = interaction.isChatInputCommand()
    ? interaction.options.getString('reason')
    : null;

  try {
    const botMember = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());

    const ticketChannel = await interaction.guild.channels.create({
      name: sanitizeChannelName(`ticket-${interaction.user.username}`),
      type: ChannelType.GuildText,
      parent: ticketCategory.id,
      topic: reason ? `${interaction.user.tag} | ${reason}` : `Ticket for ${interaction.user.tag}`,
      reason: reason
        ? `Ticket opened by ${interaction.user.tag}: ${reason}`
        : `Ticket opened by ${interaction.user.tag}`,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: botMember.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    await ticketChannel.send(
      reason
        ? t(guildSettings?.language, 'ticket_created_thread_message', {
            user: interaction.user.id,
            reason,
          })
        : t(guildSettings?.language, 'ticket_opened_thread_message', {
            user: interaction.user.id,
          })
    );

    await interaction.reply({
      content: t(guildSettings?.language, reason ? 'ticket_created_reply' : 'ticket_opened_reply', {
        url: ticketChannel.url,
      }),
      flags: MessageFlags.Ephemeral,
    });

    GuildLogger.info(
      interaction.guild.id,
      `User ${interaction.user.displayName} opened a ticket (${ticketChannel.id})`
    );
  } catch (error) {
    GuildLogger.error(interaction.guild.id, `Could not create ticket channel: ${error}`);
    Logging.error(`Error in "createTicket": ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_open_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function closeTicket(
  interaction: ChatInputCommandInteraction,
  data: any
): Promise<void> {
  if (!interaction.guild) return;

  const guildSettings = await getGuildSettings(interaction.guild.id);

  GuildLogger.info(
    interaction.guild.id,
    `User ${interaction.user.displayName} ran the command /ticket close`
  );

  const channel = interaction.channel;

  if (!channel || channel.isThread() || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_only_in_threads'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (channel.parentId !== data.channel && channel.parentId !== data.channelConf) {
    Logging.info('Someone tried a ticket close command in a non ticket channel');

    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_not_a_ticket_thread'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botId = interaction.client.user.id;
  const ownerOverwrite = channel.permissionOverwrites.cache.find(
    (overwrite) => overwrite.type === OverwriteType.Member && overwrite.id !== botId
  );
  const isTicketOwner = ownerOverwrite?.id === interaction.user.id;
  const hasManageChannels = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);

  if (!isTicketOwner && !hasManageChannels) {
    Logging.info(
      'Someone tried a ticket close command without being ticket owner and without permissions'
    );

    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_close_permission_denied'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.reply(
      t(guildSettings?.language, 'ticket_closed_reply', { user: interaction.user.tag })
    );

    setTimeout(() => {
      channel.delete(`Ticket closed by ${interaction.user.tag}`).catch((error) => {
        Logging.error(`Could not delete ticket channel ${channel.id}: ${error}`);
      });
    }, 5000);
  } catch (error) {
    Logging.error(`Error inside "closeTicket": ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'ticket_generic_error'),
    });
  }
}
