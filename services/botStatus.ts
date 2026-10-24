import { type ChatInputCommandInteraction, type ColorResolvable, EmbedBuilder } from 'discord.js';
import { getGuildSettings } from '../lib/guildSettings';
import { t } from '../lib/i18n';
import { getEnv } from '../lib/env';
import { getRedisClient } from '../lib/redis';
import { prisma } from '../lib/prisma';

/** Nothing in the status command may keep the interaction waiting longer than this. */
const CHECK_TIMEOUT_MS = 5000;

type ServiceState = 'online' | 'offline' | 'unconfigured';

interface ServiceStatus {
  /** Translation key for the service name. */
  labelKey: string;
  state: ServiceState;
  /** Round trip in ms, or null when the service was never reached. */
  latency: number | null;
}

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
};

/** Runs a check and reports how long it took, treating any throw as "offline". */
const check = async (labelKey: string, probe: () => Promise<unknown>): Promise<ServiceStatus> => {
  const start = Date.now();

  try {
    await withTimeout(Promise.resolve(probe()), CHECK_TIMEOUT_MS);
    return { labelKey, state: 'online', latency: Date.now() - start };
  } catch {
    return { labelKey, state: 'offline', latency: null };
  }
};

const checkHttp = (labelKey: string, url: string): Promise<ServiceStatus> =>
  check(labelKey, async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  });

function stateEmoji(state: ServiceState): string {
  if (state === 'online') return '🟢';
  if (state === 'offline') return '🔴';
  return '⚪';
}

function stateValue(lang: string, service: ServiceStatus): string {
  if (service.state === 'unconfigured') return t(lang, 'status_unconfigured');
  if (service.state === 'offline') return `**${t(lang, 'status_offline')}**`;

  const latency = service.latency === null ? '' : `\n\`${service.latency} ms\``;

  return `**${t(lang, 'status_online')}**${latency}`;
}

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guildId!);
  const lang = guildSettings.language ?? 'en';
  const client = interaction.client;

  // The probes below can take seconds; the initial reply window is only three.
  await interaction.deferReply();

  const influxUrl = getEnv('INFLUXDB_URL');

  const services: ServiceStatus[] = await Promise.all([
    check('bot_field_bot', async () => {
      if (!client.isReady()) throw new Error('Client not ready');
    }).then((status) => ({
      ...status,
      // The gateway already tracks its own heartbeat; -1 means "not measured yet".
      latency: client.ws.ping >= 0 ? Math.round(client.ws.ping) : null,
    })),
    checkHttp('bot_field_dashboard', 'https://botinorbit.com'),
    checkHttp('bot_field_cms', 'https://cms.rc-garage.nl'),
    check('bot_field_redis', () => getRedisClient().ping()),
    influxUrl
      ? checkHttp('bot_field_influx', `${influxUrl.replace(/\/+$/, '')}/ping`)
      : Promise.resolve<ServiceStatus>({
          labelKey: 'bot_field_influx',
          state: 'unconfigured',
          latency: null,
        }),
    check('bot_field_postgres', () => prisma.$queryRaw`SELECT 1`),
  ]);

  const online = services.filter((service) => service.state === 'online').length;
  const degraded = services.some((service) => service.state === 'offline');

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'bot_status_title'))
    .setDescription(
      degraded ? t(lang, 'bot_status_degraded') : t(lang, 'bot_status_all_operational')
    )
    .setColor(
      degraded ? '#ED4245' : ((guildSettings?.primaryColor as ColorResolvable) ?? '#2F3136')
    )
    .addFields(
      services.map((service) => ({
        name: `${stateEmoji(service.state)} ${t(lang, service.labelKey)}`,
        value: stateValue(lang, service),
        inline: true,
      }))
    )
    .setFooter({
      text: t(lang, 'bot_status_footer', {
        online: String(online),
        total: String(services.length),
      }),
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
