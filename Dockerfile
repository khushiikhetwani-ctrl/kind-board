FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js moderation.js content.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/kindboard.db
VOLUME /data
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
