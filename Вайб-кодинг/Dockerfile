FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
