FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV LUMEN_PUBLIC_MODE=true
RUN npm run build && npm prune --omit=dev && chmod +x docker-entrypoint.sh
ENV NODE_ENV=production
ENV LUMEN_DATA=/data/lumen.sqlite
RUN mkdir -p /data && chown -R node:node /app /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
