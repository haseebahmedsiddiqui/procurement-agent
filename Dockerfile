# ------------------------------------------------------------------
# Procurement Agent — Multi-stage Docker build
# Stage 1: install deps + build Next.js
# Stage 2: slim production image with Playwright Chromium
# ------------------------------------------------------------------

# ---- Stage 1: Build ----
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ---- Stage 2: Production ----
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install Playwright system deps + Chromium only (no Firefox/WebKit)
RUN npx playwright install --with-deps chromium

# Copy built assets from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create directories for persistent data
RUN mkdir -p /app/sessions /app/exports /app/backups

EXPOSE 3000

CMD ["npm", "start"]
