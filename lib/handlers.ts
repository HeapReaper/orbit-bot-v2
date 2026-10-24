import type { ApiRoutes, BotEvent, Command, Component, Task } from '../types';
import { loadDefaults } from './loader';

export const loadCommands = () =>
  loadDefaults(
    'commands',
    (value): value is Command<any> => !!value?.data && typeof value?.execute === 'function',
    'command (needs "data" and "execute")'
  );

export const loadComponents = () =>
  loadDefaults(
    'components',
    (value): value is Component =>
      (typeof value?.customId === 'string' || value?.customId instanceof RegExp) &&
      typeof value?.execute === 'function',
    'component (needs "customId" and "execute")'
  );

export const loadEvents = () =>
  loadDefaults(
    'events',
    (value): value is BotEvent => !!value?.name && typeof value?.execute === 'function',
    'event (needs "name" and "execute")'
  );

export const loadTasks = () =>
  loadDefaults(
    'tasks',
    (value): value is Task =>
      !!value?.name && !!value?.schedule && typeof value?.execute === 'function',
    'task (needs "name", "schedule" and "execute")'
  );

export const loadApiRoutes = () =>
  loadDefaults('api', (value): value is ApiRoutes => typeof value === 'function', 'API route file');
