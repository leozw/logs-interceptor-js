/**
 * Preload script for logs-interceptor
 * Auto-initializes only when LOGS_* is present
 */

(function () {
  'use strict';
  if (!require('node:worker_threads').isMainThread) return;

  if (global.__LOGS_INTERCEPTOR_PRELOADED) {
    return;
  }

  global.__LOGS_INTERCEPTOR_PRELOADED = true;

  const debug = process.env.LOGS_DEBUG === 'true';
  const silent = process.env.LOGS_SILENT_ERRORS === 'true';

  const debugLog = (...args) => {
    if (debug && !silent) {
      console.log('[logs-interceptor:preload]', ...args);
    }
  };

  const errorLog = (...args) => {
    if (!silent) {
      console.error('[logs-interceptor:preload]', ...args);
    }
  };

  if (process.env.LOGS_ENABLED === 'false') {
    debugLog('Disabled by LOGS_ENABLED=false');
    return;
  }

  try {
    process.env.LOGS_AUTO_INIT = 'true';

    const logsInterceptor = require('./dist/index.js');

    if (typeof logsInterceptor.isInitialized === 'function' && logsInterceptor.isInitialized()) {
      debugLog('Initialized successfully via auto-init gate');
    } else {
      debugLog('Auto-init did not run (missing required LOGS_* variables)');
    }

    const gracefulShutdown = async (signal) => {
      debugLog(`Graceful shutdown triggered by ${signal}`);
      let timer;

      try {
        if (typeof logsInterceptor.destroy === 'function') {
          await Promise.race([
            logsInterceptor.destroy(),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Telemetry shutdown deadline exceeded')), 10000);
            }),
          ]);
        }
      } catch (error) {
        errorLog('Graceful shutdown failed:', error && error.message ? error.message : error);
      } finally {
        clearTimeout(timer);
        process.off('SIGTERM', onTerm);
        process.off('SIGINT', onInt);
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      }
    };

    const onTerm = () => { void gracefulShutdown('SIGTERM'); };
    const onInt = () => { void gracefulShutdown('SIGINT'); };
    if (logsInterceptor.isInitialized()) {
      process.once('SIGTERM', onTerm);
      process.once('SIGINT', onInt);
    }
  } catch (error) {
    errorLog('Preload failed:', error && error.message ? error.message : error);

    if (debug && !silent) {
      console.error('[logs-interceptor:preload] stack:', error && error.stack ? error.stack : 'N/A');
    }
  }
})();
