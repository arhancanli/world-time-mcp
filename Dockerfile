FROM node:26-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1
WORKDIR /app
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
USER node
ENTRYPOINT ["node", "src/server.mjs"]
