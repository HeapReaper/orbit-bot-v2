import { prisma } from '../lib/prisma';

export const MODAL_ID = 'wheelspin_modal';
export const INPUT_ID = 'wheelspin_names';
export const MIN_NAMES = 2;
export const MAX_NAMES = 20;

export async function getWheelSpinSettings(guildId: string) {
  return prisma.wheelSpinSettings.findUnique({ where: { guildId } });
}
