# Build context is the repository root: docker compose builds it with `context: .`.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate
WORKDIR /app

# Manifests only, so the install layer is cached until a dependency changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/cv-template/package.json packages/cv-template/

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@cv/api..."
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter "@cv/api..." build

# Runtime: production dependencies only, plus Chromium for the PDF renderer.
FROM manifests AS runtime
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm install --frozen-lockfile --prod --filter "@cv/api..."
# Chromium and its system libraries; the browser stays readable for the unprivileged user.
RUN pnpm --filter @cv/api exec playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/cv-template/dist packages/cv-template/dist
COPY packages/cv-template/fonts packages/cv-template/fonts
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
# Compose runs the API as an unprivileged user; Chromium's own sandbox is disabled in code (see README).
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
