FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV LUMEN_DATA=/data/lumen.sqlite
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
