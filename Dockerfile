# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# A three-stage build: dependencies, compile, run.
#
# The runtime stage copies `.next/standalone` -- the directory `next build`
# fills with exactly the files the server reaches -- so it carries no
# `node_modules` and runs no install. Everything with a compiler in it stays in
# the stages above and never reaches the image.
#
# **Every COPY names explicit paths rather than `COPY . .`.** `.dockerignore`
# is a tracked file, so anything excluded by name there is published by name
# there; deciding what goes in by listing it is the version that keeps working
# when the exclusion list is somebody else's problem.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:24-alpine

# --- dependencies ----------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# The schema and the config come first because `postinstall` runs
# `prisma generate`, which needs both. It connects to nothing: the config reads
# `process.env.DATABASE_URL` directly rather than through prisma's `env()`
# helper, which throws when the variable is absent -- and here it is absent.
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma

RUN npm ci

# --- build -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY next.config.ts tsconfig.json next-env.d.ts ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY public ./public
COPY src ./src

# `next build` prerenders four routes that read the database, and there is no
# database here. They fall back to an empty result and log that they did --
# see `src/server/build.ts`, which explains why that is safe at build time and
# would not be at request time.
#
# The env values are placeholders that satisfy the Zod schema in `src/env.ts`,
# which runs at import time and would otherwise fail the build before any page
# was rendered. Nothing connects with them.
ENV NEXTAUTH_SECRET="build-time-placeholder-not-a-secret-32ch"
ENV NEXTAUTH_URL="http://localhost:3000"
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- run -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Without this the standalone server binds to localhost and nothing outside
# the container can reach it -- which looks exactly like a crashed app.
ENV HOSTNAME=0.0.0.0

# A user of its own. Root inside a container is still root on anything it is
# handed, and this process needs to read a directory and open a port.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# `node -e` rather than curl or wget: the base image has neither, and adding
# one to a runtime image to poll a URL is a package with a CVE feed attached.
# Node 24 has a global fetch.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# **The exec form, so `node` is PID 1 and receives SIGTERM directly.** A shell
# form -- `CMD node server.js` -- runs `/bin/sh -c` as PID 1, which does not
# forward signals, so `docker stop` waits the full timeout and then kills the
# process. Anything that ever wraps this in a script has to end in `exec`.
CMD ["node", "server.js"]
