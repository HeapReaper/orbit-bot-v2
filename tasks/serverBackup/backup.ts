import type { Client, GuildBasedChannel, Role } from 'discord.js';
import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';

async function createBackups(client: Client): Promise<void> {
  try {
    const guildSettings = await prisma.serverBackupSettings.findMany({
      where: { enabled: true },
    });

    const now = new Date();

    for (const setting of guildSettings) {
      // Only the date is needed; v1 loaded the whole backup JSON here.
      const lastBackup = await prisma.serverBackups.findFirst({
        where: { guildId: setting.guildId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      const due = shouldBackup(setting.frequency, lastBackup?.createdAt, now, setting.time);
      if (!due) continue;

      const guild = client.guilds.cache.get(setting.guildId);
      if (!guild) continue;

      const backupData: any = {};
      const content = setting.content as string[] | undefined;

      // Backup roles
      if (content?.includes('roles')) {
        backupData.roles = guild.roles.cache.map((role: Role) => ({
          id: role.id,
          name: role.name,
          color: role.color,
          hoist: role.hoist,
          position: role.position,
          permissions: role.permissions.bitfield,
          mentionable: role.mentionable,
        }));
      }

      // Backup channels
      if (content?.includes('channels')) {
        backupData.channels = guild.channels.cache.map((channel: GuildBasedChannel) => {
          // Only channels that have permissionOverwrites
          const permissionOverwrites =
            'permissionOverwrites' in channel && channel.permissionOverwrites
              ? Array.from(channel.permissionOverwrites.cache.values()).map((po) => ({
                  id: po.id,
                  type: po.type,
                  allow: po.allow.bitfield,
                  deny: po.deny.bitfield,
                }))
              : [];

          return {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parentId: 'parentId' in channel ? channel.parentId : null,
            permissionOverwrites,
          };
        });
      }

      // Backup emojis
      if (content?.includes('emojis')) {
        backupData.emojis = guild.emojis.cache.map((emoji) => ({
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated,
        }));
      }

      // Backup stickers
      if (content?.includes('stickers')) {
        backupData.stickers = guild.stickers.cache.map((sticker) => ({
          id: sticker.id,
          name: sticker.name,
          type: sticker.type,
        }));
      }

      // Backup server settings
      if (content?.includes('server_settings')) {
        backupData.server_settings = {
          name: guild.name,
          region: guild.preferredLocale,
          iconURL: guild.iconURL(),
        };
      }

      await prisma.serverBackups.create({
        data: {
          guildId: setting.guildId,
          backup: backupData,
        },
      });

      Logging.info(`Backup created for guild ${setting.guildId}`);
    }
  } catch (err) {
    Logging.error(`Error handling server backup task: ${err}`);
  }
}

function shouldBackup(
  frequency: string,
  lastBackup: Date | undefined,
  now: Date,
  scheduledTime?: string
): boolean {
  if (frequency === 'manual') return false;
  if (!lastBackup) return true;

  const diffMs = now.getTime() - lastBackup.getTime();
  const diffMinutes = diffMs / 1000 / 60;

  let frequencyOk = false;
  switch (frequency) {
    case 'daily':
      frequencyOk = diffMinutes >= 60 * 24;
      break;
    case 'weekly':
      frequencyOk = diffMinutes >= 60 * 24 * 7;
      break;
    case 'monthly':
      frequencyOk = diffMinutes >= 60 * 24 * 30;
      break;
  }

  if (!frequencyOk) return false;

  if (scheduledTime) {
    const [scheduledHour = 0, scheduledMinute = 0] = scheduledTime.split(':').map(Number);

    if (
      now.getHours() < scheduledHour ||
      (now.getHours() === scheduledHour && now.getMinutes() < scheduledMinute)
    ) {
      return false;
    }

    if (
      lastBackup &&
      lastBackup.getDate() === now.getDate() &&
      lastBackup.getHours() === scheduledHour &&
      lastBackup.getMinutes() === scheduledMinute
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Deletes backups past their retention: 45 days for premium guilds, 21 for the rest.
 *
 * v1 loaded every backup row, including the full backup JSON of every guild,
 * into memory once a minute and deleted them one by one. Two deleteMany calls
 * do the same in the database.
 */
async function cleanBackups(): Promise<void> {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const premiumGuildIds = (
    await prisma.premiumGuild.findMany({ where: { premium: true }, select: { guildId: true } })
  ).map((guild) => guild.guildId);

  const regular = await prisma.serverBackups.deleteMany({
    where: {
      guildId: { notIn: premiumGuildIds },
      createdAt: { lt: new Date(now - 21 * day) },
    },
  });

  const premium = await prisma.serverBackups.deleteMany({
    where: { createdAt: { lt: new Date(now - 45 * day) } },
  });

  if (regular.count + premium.count > 0) {
    Logging.info(
      `Deleted ${regular.count} expired backup(s) and ${premium.count} expired premium backup(s)`
    );
  }
}

export default {
  name: 'server-backup',
  schedule: '* * * * *',
  runOnStart: true,

  async execute(client) {
    await createBackups(client);
    await cleanBackups();
  },
} satisfies Task;
