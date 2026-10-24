import 'dotenv/config';
import { registerCommands } from './lib/registerCommands';

// Set GUILD_ID to register on a single guild for testing (updates instantly).
const guildId = process.env.GUILD_ID;

try {
  const count = await registerCommands(guildId);

  console.log(
    `Successfully reloaded ${count} ${guildId ? `guild (${guildId})` : 'global'} application (/) commands.`
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
