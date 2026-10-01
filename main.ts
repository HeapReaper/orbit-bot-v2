import { Client, Events, GatewayIntentBits, Collection, MessageFlags } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Loading commands from the commands folder
client.commands = new Collection();

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
      client.commands.set(command.data.name, command);
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
      );
    }
  }
}

// Event handling
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".ts"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const eventModule = await import(filePath);
  const event = eventModule.default;

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

// Loading tasks
const tasksPath = path.join(__dirname, "tasks");

if (fs.existsSync(tasksPath)) {
  const taskFiles = fs.readdirSync(tasksPath).filter((file) => file.endsWith(".ts"));

  for (const file of taskFiles) {
    const filePath = path.join(tasksPath, file);

    const taskModule = await import(filePath);
    const task = taskModule.default;

    if (!task?.name || !task?.schedule || !task?.execute) {
      console.log(
        `[WARNING] The task at ${filePath} is missing a required "name", "schedule" or "execute" property.`,
      );
      continue;
    }

    cron.schedule(task.schedule, task.execute);

    console.log(`Loaded task: ${task.name} (${task.schedule})`);
  }
}

client.login(process.env.DISCORD_TOKEN);
