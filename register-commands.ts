import { REST, Routes } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];

// Commands directory
const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);

  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".ts"));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);

    const commandModule = await import(filePath);
    const command = commandModule.default;

    if (command?.data && command?.execute) {
      commands.push(command.data.toJSON());
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
      );
    }
  }
}

// REST client
const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

try {
  console.log(`Started refreshing ${commands.length} application (/) commands.`);

  // Global command registration
  const data = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
    body: commands,
  });

  console.log(`Successfully reloaded ${data.length} global application (/) commands.`);
} catch (error) {
  console.error(error);
}
