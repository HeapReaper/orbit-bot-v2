export function getCurrentDate() {
  const now = new Date();
  return now.toLocaleDateString('nl-NL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Amsterdam',
  });
}

/**
 * "Which day is it" for a guild, as a day count since the epoch. Streak days used
 * to be counted off UTC midnight, so a guild in another timezone saw its streak
 * roll over at the wrong moment.
 */
export function dayNumber(date: Date, timeZone: string): number {
  try {
    const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(date)
      .split('-')
      .map(Number);

    return Date.UTC(year, month - 1, day) / 86_400_000;
  } catch {
    // Unknown timezone in the guild settings — fall back to UTC days.
    return Math.floor(date.getTime() / 86_400_000);
  }
}
