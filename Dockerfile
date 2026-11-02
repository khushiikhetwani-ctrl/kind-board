FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js moderation.js content.js ./
COPY public ./public
# Data lives in a hosted database when TURSO_DATABASE_URL is set; otherwise in this local file.
RUN mkdir -p /data
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/kindboard.db
EXPOSE 3000
CMD ["node", "server.js"]
