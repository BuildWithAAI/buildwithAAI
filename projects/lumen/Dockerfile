FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV LUMEN_PUBLIC_MODE=true
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.next/standalone ./
RUN rm -rf node_modules/typescript node_modules/@types
COPY --from=build /app/public ./public
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/zoora ./zoora
COPY --from=build /app/docs/BUILD_LOG.md ./docs/BUILD_LOG.md
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && mkdir -p /data && chown -R node:node /app /data
ENV NODE_ENV=production
ENV LUMEN_PUBLIC_MODE=true
ENV LUMEN_DATA=/data/lumen.sqlite
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
