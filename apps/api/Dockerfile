# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f apps/api/Dockerfile .
FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@10.26.1 --no-fund --no-audit
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @cc/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @cc/shared build && pnpm --filter @cc/api build
# Self-contained production bundle (prod deps only, workspace deps copied in)
RUN pnpm --filter @cc/api deploy --prod --legacy /out

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
