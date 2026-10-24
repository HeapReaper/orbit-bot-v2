import chalk from 'chalk';
import { getEnv } from './env';

export class Logging {
  static info(message: string | number): void {
    console.log(`[${this.formatDate(new Date())}] [${chalk.green('INFO')}]  ${message}`);
  }

  static warn(message: string | number): void {
    console.log(`[${this.formatDate(new Date())}] [${chalk.yellow('WARN')}]  ${message}`);
  }

  static error(message: string | number): void {
    console.log(`[${this.formatDate(new Date())}] [${chalk.red('ERROR')}] ${message}`);
  }

  static debug(message: string | number): void {
    if (getEnv('ENVIRONMENT') !== 'debug' && getEnv('ENVIRONMENT') !== 'development') return;

    console.log(`[${this.formatDate(new Date())}] [${chalk.blue('DEBUG')}] ${message}`);
  }

  static trace(message: string | number): void {
    if (
      getEnv('ENVIRONMENT') !== 'trace' &&
      getEnv('ENVIRONMENT') !== 'debug' &&
      getEnv('ENVIRONMENT') !== 'development'
    )
      return;

    console.log(`[${this.formatDate(new Date())}] [${chalk.grey('TRACE')}] ${message}`);
  }

  private static formatDate(now: Date): string {
    return `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  }
}
