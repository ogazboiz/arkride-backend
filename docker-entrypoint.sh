#!/bin/sh
set -e

# Run migrations, then start the API.
#
# WHY THIS EXISTS RATHER THAN JUST A startCommand
#
# `railway.json` also specifies a start command that does this, but a platform
# does not always use it: a service created before that file existed, or one
# with a custom start command set in the dashboard, runs the image's CMD
# instead. When that happened the API booted perfectly against a database with
# no tables, and every request returned DATABASE_ERROR while the container
# reported healthy.
#
# Putting it in the entrypoint makes the container self-sufficient: however it
# is started, the schema is applied first.
#
# `npx typeorm` against the COMPILED data source is deliberate. The production
# image has no pnpm and no ts-node — the builder stage prunes them — so
# `pnpm run migration:run` and the ts-node variant both fail here.

echo "[entrypoint] running migrations..."

if npx typeorm -d dist/data-source.js migration:run; then
  echo "[entrypoint] migrations applied"
else
  # Deliberately fatal. Starting against a schema that is missing or half
  # applied produces a container that looks healthy and 500s on every request,
  # which is far harder to diagnose than a container that refuses to start.
  echo "[entrypoint] MIGRATIONS FAILED — refusing to start against an unknown schema" >&2
  exit 1
fi

echo "[entrypoint] starting API..."
exec node dist/main
