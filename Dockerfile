# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY shared/ ./shared/
COPY server/ ./server/

RUN npm run server:build

# Stage 2: Runtime
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /build/server/dist/server.cjs ./server.cjs

ENV NODE_ENV=production
USER node

EXPOSE 8080
CMD ["node", "server.cjs"]
