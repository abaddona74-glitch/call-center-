# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f apps/web/Dockerfile .
FROM node:26-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@10.26.1 --no-fund --no-audit
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @cc/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @cc/shared build && pnpm --filter @cc/web build

# Caddy serves the SPA and reverse-proxies /api and /ws to the api container.
FROM caddy:2-alpine AS runtime
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 80 443
