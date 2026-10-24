import { REST, Routes } from 'discord.js';
import { loadCommands } from './handlers';

/**
 * Pushes every command in commands/ to Discord in one bulk PUT.
 *
 * With `guildId` the commands are registered on that one guild, which updates
 * instantly and is meant for testing. Without it they go global.
 */
export async function registerCommands(guildId?: string): Promise<number> {
  const commands = (await loadCommands()).map(({ value }) => value.data.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
  const route = guildId
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID!, guildId)
    : Routes.applicationCommands(process.env.CLIENT_ID!);

  const data = (await rest.put(route, { body: commands })) as unknown[];
  return data.length;
}
