FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace package metadata and Prisma schema
COPY package.json ./
COPY package-lock.json ./
COPY api/package.json ./api/
COPY shared/package.json ./shared/
COPY spa/package.json ./spa/
COPY worker/package.json ./worker/
COPY prisma/ ./prisma/

# Install dependencies and generate Prisma client
RUN npm install \
    && npx prisma generate --schema=prisma/schema.prisma

# Copy shared and API source
COPY shared/ ./shared/
COPY api/ ./api/

# Build
RUN npm run build --workspace=@doughray/shared \
    && npm run build --workspace=api

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/api/package.json ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/api/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/index.js"]
