import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ColorResolvable,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { Logging } from './logging';
import { t } from './i18n';

export interface LeaderboardEntry {
  userId: string;
  /** Already-translated text shown underneath the user's name. */
  value: string;
}

export interface LeaderboardOptions {
  title: string;
  entries: LeaderboardEntry[];
  language?: string | null;
  color?: string | null;
  itemsPerPage?: number;
  /** How long the paging buttons stay active, in milliseconds. */
  timeMs?: number;
}

const DEFAULT_ITEMS_PER_PAGE = 10;
const DEFAULT_TIME_MS = 120_000;
const DEFAULT_COLOR = '#2F3136';

const BACK_ID = 'leaderboard_back';
const NEXT_ID = 'leaderboard_next';

function rankLabel(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

/**
 * Renders a paginated leaderboard for `interaction`.
 *
 * Shared by every `/leaderboard <x>` subcommand. Beyond removing five copies of
 * the same code this fixes a few things the copies got wrong:
 *
 * - display names are resolved once up front (and cached per call) instead of
 *   re-fetching every user each time a page is turned;
 * - a user that can no longer be fetched (deleted account) falls back to
 *   "unknown" rather than throwing and killing the whole command;
 * - the buttons are always disabled when the collector ends, and the edit that
 *   does so tolerates a deleted message;
 * - the page index is clamped, so a stale button press cannot render an empty page.
 */
export async function sendPaginatedLeaderboard(
  interaction: CommandInteraction,
  options: LeaderboardOptions
): Promise<void> {
  const {
    title,
    entries,
    language,
    color,
    itemsPerPage = DEFAULT_ITEMS_PER_PAGE,
    timeMs = DEFAULT_TIME_MS,
  } = options;

  if (entries.length === 0) {
    await interaction.reply({
      content: t(language, 'leaderboard_no_data'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Resolving users hits the API, so do it once for the whole leaderboard while
  // the interaction is deferred rather than on every page turn.
  await interaction.deferReply();

  const totalPages = Math.max(1, Math.ceil(entries.length / itemsPerPage));
  let currentPage = 0;

  const names = new Map<string, string>();
  await Promise.all(
    [...new Set(entries.map((entry) => entry.userId))].map(async (userId) => {
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      names.set(userId, user?.displayName ?? t(language, 'unknown_user'));
    })
  );

  const buildEmbed = (page: number): EmbedBuilder => {
    const start = page * itemsPerPage;
    const pageData = entries.slice(start, start + itemsPerPage);

    const embed = new EmbedBuilder()
      .setTitle(
        `${title} - ${t(language, 'leaderboard_page', {
          current: (page + 1).toString(),
          total: totalPages.toString(),
        })}`
      )
      .setColor(((color || DEFAULT_COLOR) as ColorResolvable) ?? DEFAULT_COLOR);

    for (const [index, entry] of pageData.entries()) {
      embed.addFields({
        name: `${rankLabel(start + index + 1)} ${names.get(entry.userId) ?? t(language, 'unknown_user')}`,
        value: entry.value,
        inline: false,
      });
    }

    return embed;
  };

  const backButton = new ButtonBuilder()
    .setCustomId(BACK_ID)
    .setLabel('⬅ Back')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(true);

  const nextButton = new ButtonBuilder()
    .setCustomId(NEXT_ID)
    .setLabel('Next ➡')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(totalPages <= 1);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton, nextButton);

  const message = await interaction.editReply({
    embeds: [buildEmbed(currentPage)],
    components: [row],
  });

  if (totalPages <= 1) return;

  const collector = message.createMessageComponentCollector({ time: timeMs });

  collector.on('collect', async (btnInteraction) => {
    try {
      if (!btnInteraction.isButton()) return;

      if (btnInteraction.user.id !== interaction.user.id) {
        await btnInteraction.reply({
          content: t(language, 'leaderboard_buttons_not_for_you'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (btnInteraction.customId === BACK_ID) currentPage--;
      else if (btnInteraction.customId === NEXT_ID) currentPage++;
      else return;

      currentPage = Math.min(Math.max(currentPage, 0), totalPages - 1);

      backButton.setDisabled(currentPage === 0);
      nextButton.setDisabled(currentPage === totalPages - 1);

      await btnInteraction.update({ embeds: [buildEmbed(currentPage)], components: [row] });
    } catch (error) {
      Logging.error(`Leaderboard pagination failed: ${error}`);
    }
  });

  collector.on('end', async () => {
    backButton.setDisabled(true);
    nextButton.setDisabled(true);

    // The message may be gone by now — nothing to clean up in that case.
    await interaction.editReply({ components: [row] }).catch(() => null);
  });
}
