import chalk from 'chalk';
import { prisma } from './prisma';

export class GuildLogger {
  private static now(): Date {
    return new Date();
  }

  static info(guildId: string, message: string | number): void {
    console.log(`[${this.formatDate(this.now())}] [${chalk.green('INFO')}]  ${message}`);

    void this.saveToDB(guildId, 'INFO', message);
  }

  static warn(guildId: string, message: string | number): void {
    console.log(`[${this.formatDate(this.now())}] [${chalk.yellow('WARN')}]  ${message}`);

    void this.saveToDB(guildId, 'WARN', message);
  }

  static error(guildId: string, message: string | number): void {
    console.log(`[${this.formatDate(this.now())}] [${chalk.red('ERROR')}] ${message}`);

    void this.saveToDB(guildId, 'ERROR', message);
  }

  private static formatDate(now: Date): string {
    return `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
  }

  private static async saveToDB(
    guildId: string,
    type: string,
    message: string | number
  ): Promise<void> {
    // Fire-and-forget callers use `void`, so a failed insert must not reject.
    await prisma.guildLog
      .create({
        data: {
          guildId,
          type: type,
          message: `${message}`,
        },
      })
      .catch((error) => console.error(`[GuildLogger] Could not save log for ${guildId}: ${error}`));
  }
}
