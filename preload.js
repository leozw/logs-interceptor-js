/**
 * Preload script for logs-interceptor
 * This file automatically initializes the logs interceptor when loaded via NODE_OPTIONS
 */

(function() {
  'use strict';

  // Only run if we're not already in a preload context
  if (global.__LOGS_INTERCEPTOR_PRELOADED) {
    return;
  }
  
  global.__LOGS_INTERCEPTOR_PRELOADED = true;

  try {
    // Load the main module
    const logsInterceptor = require('./dist/index.js');
    
    // Check for required environment variables
    const url = process.env.LOGS_INTERCEPTOR_URL;
    const tenantId = process.env.LOGS_INTERCEPTOR_TENANT_ID;
    const appName = process.env.LOGS_INTERCEPTOR_APP_NAME;
    const enabled = process.env.LOGS_INTERCEPTOR_ENABLED;
    const debug = process.env.LOGS_INTERCEPTOR_DEBUG === 'true';

    // Early exit if disabled
    if (enabled === 'false') {
      if (debug) {
        console.log('[logs-interceptor] Preload: Disabled by LOGS_INTERCEPTOR_ENABLED=false');
      }
      return;
    }

    // Check if we have minimum required config
    if (!url || !tenantId || !appName) {
      if (debug) {
        console.log('[logs-interceptor] Preload: Missing required environment variables');
        console.log('[logs-interceptor] Required: LOGS_INTERCEPTOR_URL, LOGS_INTERCEPTOR_TENANT_ID, LOGS_INTERCEPTOR_APP_NAME');
        console.log('[logs-interceptor] Found:', { url: !!url, tenantId: !!tenantId, appName: !!appName });
      }
      return;
    }

    if (debug) {
      console.log('[logs-interceptor] Preload: Starting initialization...');
    }

    // Parse additional config from environment
    const config = {
      transport: {
        url: url,
        tenantId: tenantId,
        authToken: process.env.LOGS_INTERCEPTOR_AUTH_TOKEN,
        timeout: parseInt(process.env.LOGS_INTERCEPTOR_TIMEOUT) || 5000,
        maxRetries: parseInt(process.env.LOGS_INTERCEPTOR_MAX_RETRIES) || 3,
        retryDelay: parseInt(process.env.LOGS_INTERCEPTOR_RETRY_DELAY) || 1000,
        compression: process.env.LOGS_INTERCEPTOR_COMPRESSION !== 'false' ? (process.env.LOGS_INTERCEPTOR_COMPRESSION || 'gzip') : 'none',
        compressionLevel: parseInt(process.env.LOGS_INTERCEPTOR_COMPRESSION_LEVEL) || 6,
        compressionThreshold: parseInt(process.env.LOGS_INTERCEPTOR_COMPRESSION_THRESHOLD) || 1024,
        useWorkers: process.env.LOGS_INTERCEPTOR_USE_WORKERS !== 'false',
        maxWorkers: parseInt(process.env.LOGS_INTERCEPTOR_MAX_WORKERS) || 2,
        enableConnectionPooling: process.env.LOGS_INTERCEPTOR_CONNECTION_POOLING !== 'false',
        maxSockets: parseInt(process.env.LOGS_INTERCEPTOR_MAX_SOCKETS) || 50
      },
      appName: appName,
      environment: process.env.LOGS_INTERCEPTOR_ENVIRONMENT || process.env.NODE_ENV || 'production',
      version: process.env.LOGS_INTERCEPTOR_VERSION || '1.0.0',
      
      // Buffer settings
      buffer: {
        maxSize: parseInt(process.env.LOGS_INTERCEPTOR_BUFFER_SIZE) || 100,
        flushInterval: parseInt(process.env.LOGS_INTERCEPTOR_FLUSH_INTERVAL) || 5000,
        maxMemoryMB: parseInt(process.env.LOGS_INTERCEPTOR_MAX_MEMORY_MB) || 50,
        maxAge: parseInt(process.env.LOGS_INTERCEPTOR_BUFFER_MAX_AGE) || 30000,
        autoFlush: process.env.LOGS_INTERCEPTOR_AUTO_FLUSH !== 'false'
      },
      
      // Filter settings
      filter: {
        levels: process.env.LOGS_INTERCEPTOR_LOG_LEVEL ? 
          process.env.LOGS_INTERCEPTOR_LOG_LEVEL.split(',').map(l => l.trim()) : 
          ['debug', 'info', 'warn', 'error', 'fatal'],
        samplingRate: parseFloat(process.env.LOGS_INTERCEPTOR_SAMPLING_RATE) || 1.0,
        sanitize: process.env.LOGS_INTERCEPTOR_SANITIZE !== 'false',
        maxMessageLength: parseInt(process.env.LOGS_INTERCEPTOR_MAX_MESSAGE_LENGTH) || 8192
      },
      
      // Circuit Breaker
      circuitBreaker: {
        enabled: process.env.LOGS_INTERCEPTOR_CIRCUIT_BREAKER_ENABLED !== 'false',
        failureThreshold: parseInt(process.env.LOGS_INTERCEPTOR_CIRCUIT_BREAKER_THRESHOLD) || 50,
        resetTimeout: parseInt(process.env.LOGS_INTERCEPTOR_CIRCUIT_BREAKER_RESET) || 30000
      },

      // Dead Letter Queue
      deadLetterQueue: {
        enabled: process.env.LOGS_INTERCEPTOR_DLQ_ENABLED === 'true',
        type: process.env.LOGS_INTERCEPTOR_DLQ_TYPE || 'file',
        basePath: process.env.LOGS_INTERCEPTOR_DLQ_PATH || './.logs-dlq',
        maxSize: parseInt(process.env.LOGS_INTERCEPTOR_DLQ_MAX_SIZE) || 50
      },
      
      // Features
      interceptConsole: process.env.LOGS_INTERCEPTOR_INTERCEPT_CONSOLE !== 'false',
      preserveOriginalConsole: process.env.LOGS_INTERCEPTOR_PRESERVE_CONSOLE !== 'false',
      enableMetrics: process.env.LOGS_INTERCEPTOR_ENABLE_METRICS !== 'false',
      enableHealthCheck: process.env.LOGS_INTERCEPTOR_ENABLE_HEALTH_CHECK !== 'false',
      debug: debug,
      silentErrors: process.env.LOGS_INTERCEPTOR_SILENT_ERRORS === 'true'
    };

    // Parse labels if provided
    if (process.env.LOGS_INTERCEPTOR_LABELS) {
      try {
        if (process.env.LOGS_INTERCEPTOR_LABELS.startsWith('{')) {
          config.labels = JSON.parse(process.env.LOGS_INTERCEPTOR_LABELS);
        } else {
          // Parse "key1=value1,key2=value2" format
          config.labels = {};
          const pairs = process.env.LOGS_INTERCEPTOR_LABELS.split(',');
          for (const pair of pairs) {
            const [key, ...valueParts] = pair.split('=');
            if (key && valueParts.length > 0) {
              config.labels[key.trim()] = valueParts.join('=').trim();
            }
          }
        }
      } catch (error) {
        if (debug) {
          console.warn('[logs-interceptor] Failed to parse labels:', error.message);
        }
      }
    }

    // Initialize the interceptor
    const interceptor = logsInterceptor.init(config);
    
    // Store global reference
    global.__logsInterceptor = interceptor;
    
    if (debug) {
      console.log('[logs-interceptor] Preload: Successfully initialized!');
      console.log(`[logs-interceptor] App: ${config.appName}`);
      console.log(`[logs-interceptor] Environment: ${config.environment}`);
      console.log(`[logs-interceptor] Loki URL: ${config.transport.url}`);
      console.log(`[logs-interceptor] Console interception: ${config.interceptConsole ? 'enabled' : 'disabled'}`);
    }

    // Send initialization log
    interceptor.info('logs-interceptor initialized via preload', {
      method: 'preload',
      appName: config.appName,
      environment: config.environment,
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      uptime: process.uptime()
    });

    // Setup graceful shutdown
    const gracefulShutdown = async (signal) => {
      if (debug) {
        console.log(`[logs-interceptor] Preload: Graceful shutdown (${signal})`);
      }
      
      try {
        await interceptor.flush();
        await interceptor.destroy();
        if (debug) {
          console.log('[logs-interceptor] Preload: Cleanup completed');
        }
      } catch (error) {
        if (debug) {
          console.error('[logs-interceptor] Preload: Cleanup error:', error.message);
        }
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    const debug = process.env.LOGS_INTERCEPTOR_DEBUG === 'true';
    
    console.error('[logs-interceptor] Preload failed:', error.message);
    
    if (debug) {
      console.error('[logs-interceptor] Stack trace:', error.stack);
      console.error('[logs-interceptor] Environment variables:', {
        LOGS_INTERCEPTOR_URL: process.env.LOGS_INTERCEPTOR_URL,
        LOGS_INTERCEPTOR_TENANT_ID: process.env.LOGS_INTERCEPTOR_TENANT_ID,
        LOGS_INTERCEPTOR_APP_NAME: process.env.LOGS_INTERCEPTOR_APP_NAME
      });
    }
    
    // Don't crash the process, just log the error
  }

})();