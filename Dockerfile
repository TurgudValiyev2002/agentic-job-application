# One image for the web app and both workers (compose picks the command).
# It carries Playwright's Chromium for Indeed and TeX Live for CV PDFs, so it is large (~2.5 GB).

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

# TeX Live for CV PDFs; pdflatex runs in-process instead of through the orch-latex sandbox container.
COPY docker/latex/install-tex.sh /tmp/install-tex.sh
# A Windows checkout can give the script CRLF line endings, which sh rejects; strip them first.
RUN sed -i 's/\r$//' /tmp/install-tex.sh && sh /tmp/install-tex.sh && rm /tmp/install-tex.sh

# Chromium plus its system libraries and fonts. Patchright and Playwright pin the same Chromium revision.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* node_modules /root/.npm

FROM base AS build
RUN npm ci
COPY . .
# The DB client refuses to load without a URL; nothing connects during the build.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    LATEX_RUNNER=local
COPY --from=build /app ./
RUN npm prune --omit=dev \
 && npm cache clean --force \
 && rm -rf .next/cache \
 && mkdir -p .uploads .cache .keys \
 && chown -R node:node .uploads .cache .keys
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
