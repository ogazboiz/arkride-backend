# =========================
# Development
# =========================
FROM node:20-alpine AS development

WORKDIR /app

RUN npm install -g pnpm

RUN pnpm config set ignore-scripts false

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

RUN pnpm install --frozen-lockfile

COPY . .

CMD ["pnpm", "run", "start:dev"]


# =========================
# Builder
# =========================
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

RUN pnpm config set ignore-scripts false

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

RUN pnpm prune --prod


# =========================
# Production
# =========================
FROM node:20-alpine AS production

WORKDIR /app

# NOTE: pnpm is deliberately NOT installed here, and must not be assumed.
#
# The builder stage runs `pnpm prune --prod`, and this stage copies only
# package.json, node_modules and dist. There is no pnpm on the image and no
# ts-node in node_modules, so anything invoked at runtime has to work with
# plain node/npx against COMPILED JavaScript.
#
# In particular the migration step is
#   npx typeorm -d dist/data-source.js migration:run
# and NOT `pnpm run migration:run` (no pnpm) or the ts-node variant (pruned).
# Both of those have been shipped here before and both fail on start.

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

# Migrations run here, not in a platform start command. A host that ignores
# railway.json — a service created before it existed, or one with a custom
# start command — would otherwise boot the API against a database with no
# tables, which looks healthy and returns DATABASE_ERROR on every request.
CMD ["./docker-entrypoint.sh"]