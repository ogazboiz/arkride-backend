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

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main"]