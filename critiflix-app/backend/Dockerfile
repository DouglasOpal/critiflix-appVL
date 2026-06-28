# Build context is the repo root (see docker-compose.yml) so we can include admin/.
FROM node:20-alpine

WORKDIR /app/server

# Install deps first for better layer caching
COPY server/package.json ./
RUN npm install --omit=dev

# App source
COPY server/ ./

# Admin console is served at ../../admin (i.e. /app/admin)
COPY admin/ /app/admin/

EXPOSE 4000
COPY server/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]
