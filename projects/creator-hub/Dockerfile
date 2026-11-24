# Creator hub server (tracked link hub, studio and newsletter pages).
# Build and run from projects/creator-hub:
#   docker build -t creator-hub .
#   docker run --rm -p 8080:8080 -v creator-hub-data:/data --env-file .env creator-hub
# Node 22 runs the TypeScript sources directly, so there is no build step and no runtime npm dependency.
# The image includes config/offers.json and config/studio.json if they exist where you build (they are
# gitignored); without them it falls back to the *.example.json files, where every offer is inactive.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY config ./config
COPY docker/start.sh /usr/local/bin/hub-start
RUN chmod 0755 /usr/local/bin/hub-start && mkdir -p /data && chown node:node /data

VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# hub-start runs the server as the non-root "node" user. If the container starts as root (Fly.io
# volumes are mounted owned by root), it first hands /data to that user, then drops privileges.
ENTRYPOINT ["hub-start"]
