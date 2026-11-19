FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY client ./client
COPY shared ./shared
RUN npm run build

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 3001
CMD ["node", "server/src/index.js"]
