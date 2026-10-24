import {
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

const LICHESS_API = 'https://lichess.org/api';

interface LichessPerf {
  games: number;
  rating: number;
  rd: number;
  prog: number;
  prov?: boolean;
}

interface LichessUser {
  id: string;
  username: string;
  perfs: {
    bullet?: LichessPerf;
    blitz?: LichessPerf;
    rapid?: LichessPerf;
    classical?: LichessPerf;
    correspondence?: LichessPerf;
    puzzle?: LichessPerf;
  };
  createdAt: number;
  seenAt: number;
  playTime: { total: number; tv: number };
  url: string;
  count: {
    all: number;
    rated: number;
    win: number;
    loss: number;
    draw: number;
  };
  title?: string;
  patron?: boolean;
}

async function resolveUsername(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const input = interaction.options.getString('username');
  if (input) return input;

  const link = await prisma.lichessLink.findUnique({
    where: { userId: interaction.user.id },
  });

  if (!link) {
    const guildSettings = interaction.guild ? await getGuildSettings(interaction.guild.id) : null;

    // profile and stats defer first; v1 called reply() here, which then threw
    const payload = { content: t(guildSettings?.language, 'lichess_no_username') };
    if (interaction.deferred) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return null;
  }

  return link.lichessUsername;
}

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  GuildLogger.info(interaction.guild.id, `User ${interaction.user.username} ran /lichess link`);

  const guildSettings = await getGuildSettings(interaction.guild.id);
  const username = interaction.options.getString('username', true);

  const user = await fetchUser(username);
  if (!user) {
    await interaction.reply({
      content: t(guildSettings?.language, 'lichess_user_not_found', { username }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await prisma.lichessLink.upsert({
      where: { userId: interaction.user.id },
      update: { lichessUsername: user.username },
      create: { userId: interaction.user.id, lichessUsername: user.username },
    });

    await interaction.reply({
      content: t(guildSettings?.language, 'lichess_link_success', { username: user.username }),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    Logging.error(`Lichess link error: ${error}`);
    await interaction.reply({
      content: t(guildSettings?.language, 'lichess_link_error'),
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleUnlink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  GuildLogger.info(interaction.guild.id, `User ${interaction.user.username} ran /lichess unlink`);

  const guildSettings = await getGuildSettings(interaction.guild.id);

  const existing = await prisma.lichessLink.findUnique({
    where: { userId: interaction.user.id },
  });

  if (!existing) {
    await interaction.reply({
      content: t(guildSettings?.language, 'lichess_not_linked'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await prisma.lichessLink.delete({ where: { userId: interaction.user.id } });
  await interaction.reply({
    content: t(guildSettings?.language, 'lichess_unlink_success'),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleProfile(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply();

  const username = await resolveUsername(interaction);
  if (!username) return;

  const [user, guildSettings] = await Promise.all([
    fetchUser(username),
    getGuildSettings(interaction.guild.id),
  ]);

  if (!user) {
    await interaction.editReply(t(guildSettings?.language, 'lichess_user_not_found', { username }));
    return;
  }

  const createdAtSec = Math.floor(user.createdAt / 1000);
  const seenAtSec = Math.floor(user.seenAt / 1000);

  const totalGames = user.count.all;
  const playTimeHours = (user.playTime.total / 3600).toFixed(1);

  const embed = new EmbedBuilder()
    .setColor((guildSettings?.primaryColor as ColorResolvable) ?? '#7289DA')
    .setTitle(`${user.title ? `[${user.title}] ` : ''}${user.username}${user.patron ? ' ⭐' : ''}`)
    .setURL(user.url)
    .addFields(
      {
        name: t(guildSettings?.language, 'chess_field_member_since'),
        value: `<t:${createdAtSec}:D>`,
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'lichess_field_last_seen'),
        value: `<t:${seenAtSec}:R>`,
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'lichess_field_total_games'),
        value: totalGames.toLocaleString(),
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'lichess_field_play_time'),
        value: t(guildSettings?.language, 'lichess_play_time_value', { hours: playTimeHours }),
        inline: true,
      },
      {
        name: t(guildSettings?.language, 'lichess_field_record'),
        value: t(guildSettings?.language, 'lichess_record_value', {
          win: user.count.win.toString(),
          loss: user.count.loss.toString(),
          draw: user.count.draw.toString(),
        }),
        inline: true,
      }
    )
    .setFooter({ text: 'Lichess' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  await interaction.deferReply();

  const username = await resolveUsername(interaction);
  if (!username) return;

  const [user, guildSettings] = await Promise.all([
    fetchUser(username),
    getGuildSettings(interaction.guild.id),
  ]);

  if (!user) {
    await interaction.editReply(t(guildSettings?.language, 'lichess_user_not_found', { username }));
    return;
  }

  const formatPerf = (perf?: LichessPerf): string => {
    if (!perf || perf.games === 0) return t(guildSettings?.language, 'chess_no_games');
    const provisional = perf.prov ? '?' : '';
    return t(guildSettings?.language, 'lichess_perf_value', {
      rating: perf.rating.toString(),
      provisional,
      rd: perf.rd.toString(),
      games: perf.games.toString(),
    });
  };

  const embed = new EmbedBuilder()
    .setColor((guildSettings?.primaryColor as ColorResolvable) ?? '#7289DA')
    .setTitle(t(guildSettings?.language, 'lichess_stats_title', { username: user.username }))
    .setURL(user.url)
    .addFields(
      {
        name: t(guildSettings?.language, 'chess_field_bullet'),
        value: formatPerf(user.perfs.bullet),
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'chess_field_blitz'),
        value: formatPerf(user.perfs.blitz),
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'chess_field_rapid'),
        value: formatPerf(user.perfs.rapid),
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'lichess_field_classical'),
        value: formatPerf(user.perfs.classical),
        inline: false,
      },
      {
        name: t(guildSettings?.language, 'lichess_field_correspondence'),
        value: formatPerf(user.perfs.correspondence),
        inline: false,
      }
    )
    .setFooter({ text: 'Lichess' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function fetchUser(username: string): Promise<LichessUser | null> {
  try {
    const res = await fetch(`${LICHESS_API}/user/${encodeURIComponent(username)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as LichessUser;
  } catch {
    return null;
  }
}
