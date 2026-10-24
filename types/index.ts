import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  CommandInteraction,
  ClientEvents,
  ModalSubmitInteraction,
  AnySelectMenuInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import type { Application } from 'express';

/**
 * A slash command or context menu command, one per file in commands/<category>/.
 * Context menu commands pass their interaction type, e.g.
 * `Command<MessageContextMenuCommandInteraction>`.
 */
export interface Command<I extends CommandInteraction = ChatInputCommandInteraction> {
  data: { name: string; toJSON(): RESTPostAPIApplicationCommandsJSONBody };
  execute(interaction: I): Promise<unknown>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<unknown>;
}

export type ComponentInteraction =
  ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

/**
 * Handler for a button, select menu or modal, one per file in components/<module>/.
 * A string customId matches exactly, a RegExp is tested against the customId.
 */
export interface Component {
  customId: string | RegExp;
  execute(interaction: ComponentInteraction): Promise<unknown>;
}

/** A Discord gateway event handler, one per file in events/<module>/. */
export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(...args: ClientEvents[K]): Promise<unknown> | unknown;
}

/** A cron job, one per file in tasks/<module>/. Tasks only start once the client is ready. */
export interface Task {
  name: string;
  schedule: string;
  /** Also run once right after startup. */
  runOnStart?: boolean;
  /** IANA timezone the schedule is evaluated in; the server's timezone when omitted. */
  timezone?: string;
  execute(client: Client<true>): Promise<unknown> | unknown;
}

/** Registers Express routes, one per file in api/. */
export type ApiRoutes = (app: Application, client: Client) => void;

export function defineEvent<K extends keyof ClientEvents>(event: BotEvent<K>): BotEvent<K> {
  return event;
}

export interface EmbedData {
  color?: string;
  title?: string;
  titleUrl?: string;
  description?: string;
  author?: {
    name?: string;
    icon?: string;
  };
  thumbnail?: string;
  image?: string;
  footer?: {
    text?: string;
    icon?: string;
  };
  fields?: {
    name: string;
    value: string;
    inline?: boolean;
  }[];
}

export interface UserStreakType {
  userId: string;
  streak: number;
  lastActive: Date;
}
