# Build context is the repository root: docker compose builds it with `context: .`.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH pnpm_config_update_notifier=false
# pnpm fetches its native binary on the first run; running it here puts the binary in the shared layer,
# so the build and runtime stages do not download it again.
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate && pnpm --version
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
# Only Chrome Headless Shell and its system libraries: the PDF renderer always runs headless, so the full
# Chrome for Testing would only add weight. The browser stays readable for the unprivileged user.
RUN pnpm --filter @cv/api exec playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/cv-template/dist packages/cv-template/dist
COPY packages/cv-template/fonts packages/cv-template/fonts
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
# The API runs as an unprivileged user. Chromium's own sandbox needs privileges the container does not
# grant, so the PDF module launches it with the sandbox off; the page it renders has no scripts or network.
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
