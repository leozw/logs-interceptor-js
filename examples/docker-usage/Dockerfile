# Example Dockerfile for Zero-Code Integration

FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --production
RUN yarn add logs-interceptor

COPY . .

ENV LOGS_APP_NAME="legacy-service"
ENV LOGS_URL="http://loki:3100/loki/api/v1/push"
ENV LOGS_TENANT="production"
ENV LOGS_ENABLED="true"

# Optional performance tuning
# ENV LOGS_COMPRESSION="snappy"
# ENV LOGS_USE_WORKERS="true"
# ENV LOGS_BUFFER_MAX_SIZE="2000"
# ENV LOGS_BUFFER_FLUSH_INTERVAL="2000"
# ENV LOGS_BUFFER_MAX_MEMORY_MB="512"

ENV NODE_OPTIONS="--require logs-interceptor/preload"

CMD ["node", "src/index.js"]
