# Hoppa — single-container self-host image.
#
# Builds the whole monorepo (shared -> api -> web) and runs the API, which also
# serves the static web export at / (SERVE_WEB), so one container serves the
# entire product on one origin. db:migrate + db:init run at startup, so the only
# external dependencies are Postgres and Redis (see docker-compose.yml).
#
# Note: this is intentionally a single stage. `db:migrate` (drizzle-kit) and
# `db:init` (tsx) are dev dependencies that run at container startup, so the
# image keeps the full dependency set rather than pruning to prod-only.
FROM node:20-bookworm-slim

RUN corepack enable
WORKDIR /app

# Copy the whole repo (node_modules / build output are excluded by .dockerignore)
# and install + build. --frozen-lockfile pins to pnpm-lock.yaml.
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @allebrum/shared build \
 && pnpm --filter @allebrum/api build \
 && NEXT_PUBLIC_API_URL= pnpm --filter @allebrum/web build

ENV NODE_ENV=production \
    API_PORT=8080 \
    SERVE_WEB=true \
    WEB_DIST_DIR=/app/apps/web/out

EXPOSE 8080

# Apply migrations, seed the default workspace + admin (idempotent), then serve.
CMD ["sh", "-c", "pnpm --filter @allebrum/api db:migrate && pnpm --filter @allebrum/api db:init && pnpm --filter @allebrum/api start"]
