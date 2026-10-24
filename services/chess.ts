import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ColorResolvable,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { prisma } from '../lib/prisma';
import { GuildLogger } from '../lib/guildLog';
import { Logging } from '../lib/logging';
import { getGuildSettings } from '../lib/guildSettings';
import { t } from '../lib/i18n';

const CHESS_API = 'https://api.chess.com/pub/player';
const HEADERS = { 'User-Agent': 'OrbitBot/1.0 Discord Bot' };

interface ChessProfile {
  username: string;
  name?: string;
  avatar?: string;
  title?: string;
  followers: number;
  country: string;
  joined: number;
  last_online: number;
  league?: string;
  url: string;
}

interface ChessTimeControl {
  last: { rating: number; date: number; rd: number };
  best: { rating: number; date: number; game: string };
  record: { win: number; loss: number; draw: number };
}

interface ChessStats {
  chess_rapid?: ChessTimeControl;
  chess_blitz?: ChessTimeControl;
  chess_bullet?: ChessTimeControl;
  tactics?: { highest: { rating: number }; lowest: { rating: number } };
}

export async function handleChessLeaderboard(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply();

  const type = (interaction.options.getString('type') ?? 'rapid') as 'rapid' | 'blitz' | 'bullet';
  const statKey = `chess_${type}` as keyof ChessStats;
  const typeEmoji = { rapid: '⏱️', blitz: '🔥', bullet: '⚡' }[type];
  const typeLabel = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet' }[type];

  const guildSettings = await getGuildSettings(interaction.guild.id);

  const links = await prisma.chessLink.findMany();

  const statsResults = await Promise.all(
    links.map(async (link) => {
      const stats = await fetchStats(link.chessUsername);
      const tc = stats?.[statKey] as ChessTimeControl | undefined;
      return {
        userId: link.userId,
        username: link.chessUsername,
        rating: tc?.last.rating ?? null,
      };
    })
  );

  const ranked = statsResults
    .filter((e): e is { userId: string; username: string; rating: number } => e.rating !== null)
    .sort((a, b) => b.rating - a.rating);

  if (ranked.length === 0) {
    await interaction.editReply(
      t(guildSettings?.language, 'chess_leaderboard_no_players', { type: typeLabel })
    );
    return;
  }

  const itemsPerPage = 10;
  let currentPage = 0;
  const totalPages = Math.ceil(ranked.length / itemsPerPage);

  const generateEmbed = async (page: number) => {
    const start = page * itemsPerPage;
    const pageData = ranked.slice(start, start + itemsPerPage);

    const embed = new EmbedBuilder()
      .setTitle(
        `${typeEmoji} ${t(guildSettings?.language, 'chess_leaderboard_title', { type: typeLabel })} • ${t(guildSettings?.language, 'leaderboard_page', { current: (page + 1).toString(), total: totalPages.toString() })}`
      )
      .setColor((guildSettings?.primaryColor as ColorResolvable) ?? '#2F3136')
      .setFooter({ text: 'Chess.com' })
      .setTimestamp();

    for (const [index, entry] of pageData.entries()) {
      const rank = start + index + 1;
      const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

      let displayName: string;
      try {
        const fetched = await interaction.client.users.fetch(entry.userId);
        displayName = fetched.displayName ?? entry.username;
      } catch {
        displayName = entry.username;
      }

      embed.addFields({
        name: `${rankEmoji} ${displayName}`,
        value: t(guildSettings?.language, 'chess_leaderboard_rating_field', {
          rating: entry.rating.toString(),
          username: entry.username,
          url: `https://www.chess.com/member/${entry.username}`,
        }),
        inline: false,
      });
    }

    return embed;
  };

  const backButton = new ButtonBuilder()
    .setCustomId('chess_lb_back')
    .setLabel('⬅ Back')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(true);

  const nextButton = new ButtonBuilder()
    .setCustomId('chess_lb_next')
    .setLabel('Next ➡')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(totalPages <= 1);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton, nextButton);

  const message = await interaction.editReply({
    embeds: [await generateEmbed(currentPage)],
    components: [row],
  });

  const collector = message.createMessageComponentCollector({ time: 120_000 });

  collector.on('collect', async (btnInteraction) => {
    if (!btnInteraction.isButton()) return;
    if (btnInteraction.user.id !== interaction.user.id) {
      await btnInteraction.reply({
        content: t(guildSettings?.language, 'leaderboard_buttons_not_for_you'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (btnInteraction.customId === 'chess_lb_back') currentPage--;
    else if (btnInteraction.customId === 'chess_lb_next') currentPage++;

    backButton.setDisabled(currentPage === 0);
    nextButton.setDisabled(currentPage === totalPages - 1);

    await btnInteraction.update({
      embeds: [await generateEmbed(currentPage)],
      components: [row],
    });
  });

  collector.on('end', async () => {
    backButton.setDisabled(true);
    nextButton.setDisabled(true);
    // The message may be gone by the time the collector expires.
    await message.edit({ components: [row] }).catch(() => null);
  });
}

async function resolveUsername(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const input = interaction.options.getString('username');
  if (input) return input;

  const link = await prisma.chessLink.findUnique({
    where: { userId: interaction.user.id },
  });

  if (!link) {
    const guildSettings = interaction.guild ? await getGuildSettings(interaction.guild.id) : null;

    // profile and stats defer first; v1 called reply() here, which then threw
    const payload = { content: t(guildSettings?.language, 'chess_no_username') };
    if (interaction.deferred) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return null;
  }

  return link.chessUsername;
}

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  GuildLogger.info(interaction.guild.id, `User ${interaction.user.username} ran /chess link`);

  const guildSettings = await getGuildSettings(interaction.guild.id);
  const username = interaction.options.getString('username', true);

  const profile = await fetchProfile(username);
  if (!profile) {
    await interaction.reply({
      content: t(guildSettings?.language, 'chess_user_not_found', { username }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await prisma.chessLink.upsert({
      where: { userId: interaction.user.id },
      update: { chessUsername: profile.username },
      create: { userId: interaction.user.id, chessUsername: profile.username },
    });

    await interaction.reply({
      content: t(guildSettings?.language, 'chess_link_success', { username: profile.username }),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    Logging.error(`Chess link error: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'chess_link_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleUnlink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  GuildLogger.info(interaction.guild.id, `User ${interaction.user.username} ran /chess unlink`);

  const guildSettings = await getGuildSettings(interaction.guild.id);

  const existing = await prisma.chessLink.findUnique({
    where: { userId: interaction.user.id },
  });

  if (!existing) {
    await interaction.reply({
      content: t(guildSettings?.language, 'chess_not_linked'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await prisma.chessLink.delete({ where: { userId: interaction.user.id } });
  await interaction.reply({
    content: t(guildSettings?.language, 'chess_unlink_success'),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleProfile(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply();

  const username = await resolveUsername(interaction);
  if (!username) return;

  const [profile, guildSettings] = await Promise.all([
    fetchProfile(username),
    getGuildSettings(interaction.guild.id),
  ]);

  if (!profile) {
    await interaction.editReply(t(guildSettings?.language, 'chess_user_not_found', { username }));
    return;
  }

  const countryCode = profile.country.split('/').pop()?.toUpperCase() ?? '';
  const flagEmoji = countryCode
    ? [...countryCode].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('')
    : '';

  const embed = new EmbedBuilder()
    .setColor((guildSettings?.primaryColor || '#7289DA') as ColorResolvable)
    .setTitle(
      `${t(guildSettings?.language, 'chess_profile_title')} - ${profile.title ? `[${profile.title}] ` : ''}${profile.username}`
    )
    .setURL(profile.url)
    .setThumbnail(profile.avatar ?? null)
    .addFields(
      {
        name: t(guildSettings?.language, 'chess_field_name'),
        value: profile.username ?? t(guildSettings?.language, 'value_unknown_italic'),
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'chess_field_country'),
        value: flagEmoji
          ? `${flagEmoji} ${countryCode}`
          : t(guildSettings?.language, 'value_unknown_italic'),
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'chess_field_league'),
        value: profile.league ?? t(guildSettings?.language, 'value_none_italic'),
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'chess_field_followers'),
        value: profile.followers.toLocaleString(),
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'chess_field_member_since'),
        value: `<t:${profile.joined}:D>`,
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'chess_field_last_online'),
        value: `<t:${profile.last_online}:R>`,
        inline: true,
      }
    )
    .setFooter({ text: 'Chess.com' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply();

  const username = await resolveUsername(interaction);
  if (!username) return;

  const [stats, guildSettings] = await Promise.all([
    fetchStats(username),
    getGuildSettings(interaction.guild.id),
  ]);

  if (!stats) {
    await interaction.editReply(t(guildSettings?.language, 'chess_stats_not_found', { username }));
    return;
  }

  const formatTimeControl = (tc?: ChessTimeControl): string => {
    if (!tc) return t(guildSettings?.language, 'chess_no_games');
    const { win, loss, draw } = tc.record;
    const total = win + loss + draw;
    const winRate = total > 0 ? ((win / total) * 100).toFixed(1) : '0';
    return t(guildSettings?.language, 'chess_time_control_stats', {
      rating: tc.last.rating.toString(),
      best: (tc.best?.rating ?? '?').toString(),
      win: win.toString(),
      loss: loss.toString(),
      draw: draw.toString(),
      winRate,
    });
  };

  const embed = new EmbedBuilder()
    .setColor((guildSettings?.primaryColor || '#7289DA') as ColorResolvable)
    .setTitle(t(guildSettings?.language, 'chess_stats_title', { username }))
    .setURL(`https://www.chess.com/member/${username}`)
    .addFields(
      {
        name: t(guildSettings?.language, 'chess_field_bullet'),
        value: formatTimeControl(stats.chess_bullet),
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'chess_field_blitz'),
        value: formatTimeControl(stats.chess_blitz),
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'chess_field_rapid'),
        value: formatTimeControl(stats.chess_rapid),
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'chess_field_puzzles'),
        value: stats.tactics
          ? t(guildSettings?.language, 'chess_field_puzzles_highest', {
              rating: stats.tactics.highest.rating.toString(),
            })
          : t(guildSettings?.language, 'value_no_data_italic'),
        inline: false,
      }
    )
    .setFooter({ text: 'Chess.com' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function fetchProfile(username: string): Promise<ChessProfile | null> {
  try {
    const res = await fetch(`${CHESS_API}/${encodeURIComponent(username.toLowerCase())}`, {
      headers: HEADERS,
    });
    if (!res.ok) return null;
    return (await res.json()) as ChessProfile;
  } catch {
    return null;
  }
}

async function fetchStats(username: string): Promise<ChessStats | null> {
  try {
    const res = await fetch(`${CHESS_API}/${encodeURIComponent(username.toLowerCase())}/stats`, {
      headers: HEADERS,
    });
    if (!res.ok) return null;
    return (await res.json()) as ChessStats;
  } catch {
    return null;
  }
}
