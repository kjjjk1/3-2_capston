FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json build.mjs ./
COPY *.html *.css *.js ./
COPY analysis/ ./analysis/
COPY worker/ ./worker/
RUN node build.mjs

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json server.mjs server-network.mjs postgres-store.mjs local-store.mjs stops_data.js ./
RUN npm ci --omit=dev
COPY --chown=node:node postgres/ ./postgres/
COPY --chown=node:node drizzle/ ./drizzle/
COPY --chown=node:node analysis/ ./analysis/
COPY --chown=node:node data/transit-network.json ./data/transit-network.json
USER node
EXPOSE 10000
CMD ["node", "server.mjs"]
