# Example Dockerfile for Zero-Code Integration
# You don't need to change a single line of your application code!

FROM node:20-alpine

WORKDIR /app

# 1. Install your dependencies AND logs-interceptor
COPY package.json yarn.lock ./
RUN yarn install --production
RUN yarn add logs-interceptor # Add the interceptor

COPY . .

# 2. Set the environment variables for the interceptor
ENV LOGS_INTERCEPTOR_APP_NAME="legacy-service"
ENV LOGS_INTERCEPTOR_URL="http://loki:3100/loki/api/v1/push"
ENV LOGS_INTERCEPTOR_TENANT_ID="production"
ENV LOGS_INTERCEPTOR_ENABLED="true"

# 🚀 HIGH PERFORMANCE TUNING (Optional)
# Uncomment for high-volume apps (1000+ logs/min)

# Compress with Snappy (req. Linux/Mac)
# ENV LOGS_INTERCEPTOR_COMPRESSION="snappy" 
# Use Worker Threads
# ENV LOGS_INTERCEPTOR_USE_WORKERS="true"
# Larger Batches (2000 logs or 2s)
# ENV LOGS_INTERCEPTOR_BUFFER_SIZE="2000"
# ENV LOGS_INTERCEPTOR_FLUSH_INTERVAL="2000"
# Memory Safety
# ENV LOGS_INTERCEPTOR_MAX_MEMORY_MB="512"

# 3. CRITICAL: Preload the interceptor using NODE_OPTIONS
# This injects the interceptor before your app starts
ENV NODE_OPTIONS="--require logs-interceptor/preload"

# 4. Run your app normally
CMD ["node", "src/index.js"]
