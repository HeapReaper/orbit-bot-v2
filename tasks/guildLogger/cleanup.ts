import type { Task } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';

export default {
  name: 'guild-logger-cleanup',
  schedule: '0 0 * * *',

  async execute() {
    const now = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(now.getMonth() - 1);

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(now.getMonth() - 3);

    const deleted = await prisma.botLog.deleteMany({
      where: { timestamp: { lt: oneMonthAgo } },
    });

    const deletedGuildLog = await prisma.guildLog.deleteMany({
      where: { timestamp: { lt: threeMonthsAgo } },
    });

    Logging.info(`[Bot Log Cleanup] Deleted ${deleted.count} logs older than 1 month.`);
    Logging.info(`[Guild Log Cleanup] Deleted ${deletedGuildLog.count} logs older than 3 months.`);
  },
} satisfies Task;
