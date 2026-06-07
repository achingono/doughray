FROM node:20-alpine AS builder
ARG SIMPLEFIN_CLI_RELEASE=v0.0.1

WORKDIR /app

# Copy root workspace files
COPY package.json ./
COPY package-lock.json ./
COPY api/package.json ./api/
COPY shared/package.json ./shared/
COPY spa/package.json ./spa/
COPY worker/package.json ./worker/
COPY prisma/ ./prisma/

# Install dependencies and generate Prisma client in the worker workspace
RUN npm install \
    && npx prisma generate --schema=prisma/schema.prisma

# Copy shared and worker source
COPY shared/ ./shared/
COPY worker/ ./worker/

# Build
RUN npm run build --workspace=@doughray/shared \
    && npm run build --workspace=worker

# Production stage
FROM node:20-alpine

# You must define this ARG if you are using it in the URL
ARG SIMPLEFIN_CLI_RELEASE=v0.0.1

WORKDIR /app

RUN set -eux; \
    # Install dependencies needed for the download and extraction
    apk add --no-cache curl tar; \
    \
    tmpdir="$(mktemp -d)"; \
    install -d /opt/simplefin-cli; \
    \
    # Use the variable and ensure the URL isn't truncated
    # Change the URL to match GitHub's naming convention for source archives
    curl -fsSL -o "$tmpdir/simplefin-cli.tar.gz" \
    "https://github.com/achingono/simplefin-cli/archive/refs/tags/${SIMPLEFIN_CLI_RELEASE}.tar.gz"; \
    tar -xzf "$tmpdir/simplefin-cli.tar.gz" --strip-components=1 -C /opt/simplefin-cli; \
    cd /opt/simplefin-cli; \
    \
    npm install --no-fund --no-audit; \
    npm run build; \
    npm prune --omit=dev --omit=optional; \
    chmod +x /opt/simplefin-cli/dist/cli.js; \
    ln -sf /opt/simplefin-cli/dist/cli.js /usr/local/bin/simplefin-cli; \
    \
    # Verify installation
    simplefin-cli --help >/dev/null; \
    \
    # Cleanup: remove tmpdir AND the packages we no longer need to keep the image slim
    rm -rf "$tmpdir"; \
    apk del curl

COPY --from=builder /app/worker/package.json ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/worker/dist ./dist
COPY --from=builder /app/prisma ./prisma

CMD ["node", "dist/index.js"]
