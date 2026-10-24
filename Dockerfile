FROM oven/bun:1.4.4

ENV TZ=Europe/Amsterdam \
    NODE_ENV=production \
    API_PORT=3144

RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata openssl ca-certificates \
  && ln -fs /usr/share/zoneinfo/$TZ /etc/localtime \
  && echo $TZ > /etc/timezone \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so code changes reuse this layer
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Generating the client needs no database, but the Prisma config requires the variable
RUN DATABASE_URL=postgres://build bun --bun prisma generate

RUN chown -R bun:bun /app
USER bun

EXPOSE 3144

# /health only answers once the bot has logged in, so allow time for the gateway
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.API_PORT || 3144) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Exec form: bun is PID 1 and receives SIGTERM, so main.ts shuts down cleanly
CMD ["bun", "run", "main.ts"]
