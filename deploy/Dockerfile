FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tesseract-ocr tesseract-ocr-eng poppler-utils && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.19.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
# Generation needs a syntactically valid URL, not access to a database or production secret.
RUN cd apps/api && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm exec prisma generate
RUN pnpm --filter @kudi-guide/shared build && pnpm --filter api build && pnpm --filter web build
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN chown -R node:node /app/apps/web/.next
USER node
FROM build AS api
WORKDIR /app/apps/api
CMD ["node", "dist/src/server.js"]
FROM build AS web
WORKDIR /app/apps/web
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
