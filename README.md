# Orbit Bot V2

> [!NOTE]
> This repo comes from Orbit V1, which was mostly written by humans. AI has been used to convert V1 to the correct V2 structure.
> Most commits are human written

Orbit V2, without memory leak this time

## Running

```sh
bun install
bun run prisma:generate   # generates the Prisma client into generated/prisma
bun run register          # registers the slash commands (set GUILD_ID to test on one guild)
bun run start             # or `bun run dev` to restart on file changes
```

Copy `.env.example` to `.env` and fill it in. `bun run typecheck` and `bun run format` keep the code tidy.

### Coolify

1. New resource → your Git repository → build pack **Dockerfile**.
2. Set the variables from `.env.example` under **Environment Variables**. `DATABASE_URL` and
   `REDIS_URL` can point at Postgres/Redis resources in the same Coolify project (use their
   internal URLs).
3. **Ports Exposes**: `3144`. Give it a domain only if the dashboard uses the API; the bot itself
   needs no inbound traffic.
4. Optional **Pre-deployment command**: `bun --bun prisma migrate deploy` applies new migrations
   on every deploy.
5. After the first deploy, and whenever commands change, run `bun run register` once from the
   container's **Terminal** tab.

The container has a healthcheck on `/health`, which only answers once the bot has logged in to
Discord, so a bad token shows up as an unhealthy deployment.

## Structure

Every file is picked up automatically, at any folder depth:

| Folder        | Default export                                     | Loaded                   |
| ------------- | -------------------------------------------------- | ------------------------ |
| `commands/`   | `{ data, execute, autocomplete? }` (`Command`)     | on startup               |
| `components/` | `{ customId, execute }` for buttons/selects/modals | on startup               |
| `events/`     | `defineEvent({ name, once?, execute })`            | on startup               |
| `tasks/`      | `{ name, schedule, execute(client) }` (`Task`)     | once the client is ready |
| `api/`        | `(app, client) => void` (Express routes)           | once the client is ready |

Shared code lives in `lib/` (generic helpers: Prisma, Redis, i18n, logging, ...)
and `services/` (logic of one feature that several of its files share). Types are in `types/`.

A `customId` given as a string matches exactly, a RegExp is tested against the id.
Tasks never overlap: a run that takes longer than its interval skips the next tick.

## Modules

### Automation

- [x] Bumper
- [x] DH Bumper
- [x] Introduction
- [x] Auto Message
- [x] Welcome Message
- [x] Leave Message

### Moderation

- [x] Anti Bot
- [x] Role Kick
- [x] Auto Role
- [x] Logging
- [x] Mod Link
- [x] Message Report
- [x] Moderation

### Analytics / Tracking

- [x] Analytics
- [x] Invite Tracker
- [x] Time Keeper

### Events / Server Management

- [x] Birthday
- [x] Tickets
- [x] Donations
- [x] Leveling
- [x] Git Buddy
- [x] Server Backup
- [x] Server Anniversary

### Fun / Engagement

- [x] Counting Game
- [x] Chess.com
- [x] Lichess.org
- [x] Picture Contest
- [x] Number Guesser
- [x] RSS
- [x] Channel of Fame
- [x] Server Stats
- [x] Giveaway
- [x] Streak
- [x] QOTD
- [x] Wheel Spin

### Streaming / Media

- [x] Youtube Watcher
- [x] Twitch Watcher
- [x] Kick Watcher
- [x] Minecraft
- [x] Boost Spotlight
