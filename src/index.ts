/**
 * Main Entry Point - Clean Architecture Implementation
 * Public API for logs-interceptor
 */
import { ConfigService, LogsInterceptorConfig } from './application';
import { HealthStatus, ILogger, LoggerMetrics } from './domain/interfaces/ILogger';
import { LogLevel } from './domain/value-objects/LogLevel';
import { LogsInterceptorFactory } from './presentation/factory/LogsInterceptorFactory';
import { loadConfigFromEnv, mergeConfigs } from './utils';

export * from './infrastructure/integrations';

let globalInstance: ILogger | null = null;

/**
 * Initialize the logs interceptor with configuration
 * Can be called multiple times - subsequent calls will update the configuration
 */
export function init(
  userConfig: Partial<LogsInterceptorConfig> = {}
): ILogger {
  // Load configuration from environment
  const envConfig = loadConfigFromEnv();

  // Merge configurations
  const mergedConfig = mergeConfigs(userConfig, envConfig);

  // Validate configuration
  const errors = ConfigService.validate(mergedConfig);
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  // Resolve configuration with defaults
  const resolvedConfig = ConfigService.resolve(
    mergedConfig as LogsInterceptorConfig
  );

  // Destroy existing instance if it exists
  if (globalInstance) {
    globalInstance.destroy().catch(() => {
      // Ignore errors during cleanup
    });
  }

  // Create new instance using factory
  const { logger } = LogsInterceptorFactory.create(resolvedConfig);
  globalInstance = logger;

  return logger;
}

/**
 * Get the global logger instance
 * Throws an error if not initialized
 */
export function getLogger(): ILogger {
  if (!globalInstance) {
    throw new Error('LogsInterceptor not initialized. Call init() first.');
  }
  return globalInstance;
}

/**
 * Check if the logger is initialized
 */
export function isInitialized(): boolean {
  return globalInstance !== null;
}

/**
 * Destroy the global logger instance
 */
export async function destroy(): Promise<void> {
  if (globalInstance) {
    await globalInstance.destroy();
    globalInstance = null;
  }
}

/**
 * Auto-initialize if environment variables are present
 * This allows the logger to work automatically when loaded via NODE_OPTIONS
 */
function autoInit(): void {
  // Only auto-initialize if we have the required environment variables
  const envConfig = loadConfigFromEnv();

  if (
    envConfig.transport?.url &&
    envConfig.transport?.tenantId &&
    envConfig.appName &&
    process.env.LOGS_INTERCEPTOR_ENABLED !== 'false'
  ) {
    try {
      init(envConfig);
      console.log(
        '[logs-interceptor] Auto-initialized from environment variables'
      );
    } catch (error) {
      console.error('[logs-interceptor] Auto-initialization failed:', error);
    }
  }
}

// Convenience exports for direct usage without initialization
export const logger = {
  /**
   * Log a debug message
   */
  debug: (message: string, context?: Record<string, unknown>) => {
    if (globalInstance) {
      globalInstance.debug(message, context);
    }
  },

  /**
   * Log an info message
   */
  info: (message: string, context?: Record<string, unknown>) => {
    if (globalInstance) {
      globalInstance.info(message, context);
    }
  },

  /**
   * Log a warning message
   */
  warn: (message: string, context?: Record<string, unknown>) => {
    if (globalInstance) {
      globalInstance.warn(message, context);
    }
  },

  /**
   * Log an error message
   */
  error: (message: string, context?: Record<string, unknown>) => {
    if (globalInstance) {
      globalInstance.error(message, context);
    }
  },

  /**
   * Generic log method
   */
  log: (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    if (globalInstance) {
      globalInstance.log(level, message, context);
    }
  },

  /**
   * Log a fatal message
   */
  fatal: (message: string, context?: Record<string, unknown>) => {
    if (globalInstance) {
      globalInstance.fatal(message, context);
    }
  },

  /**
   * Track an event
   */
  trackEvent: (eventName: string, properties?: Record<string, unknown>) => {
    if (globalInstance) {
      globalInstance.trackEvent(eventName, properties);
    }
  },

  /**
   * Force flush logs
   */
  flush: async (): Promise<void> => {
    if (globalInstance) {
      return globalInstance.flush();
    }
  },

  /**
   * Get metrics
   */
  getMetrics: (): LoggerMetrics => {
    if (!globalInstance) {
      throw new Error('LogsInterceptor not initialized');
    }
    return globalInstance.getMetrics();
  },

  /**
   * Get health status
   */
  getHealth: (): HealthStatus => {
    if (!globalInstance) {
      throw new Error('LogsInterceptor not initialized');
    }
    return globalInstance.getHealth();
  },

  /**
   * Destroy the logger
   */
  destroy: async (): Promise<void> => {
    if (globalInstance) {
      await globalInstance.destroy();
      globalInstance = null;
    }
  },
};

// Auto-initialize when module is loaded
autoInit();

// Default export for convenience
export default {
  init,
  getLogger,
  isInitialized,
  destroy,
  logger,
};

// Export types and interfaces (selective exports to avoid conflicts)
export type { LogsInterceptorConfig, ResolvedLogsInterceptorConfig } from './application/config/LogsInterceptorConfig';
export type { LogEntry, LogMetadata } from './domain/entities/LogEntry';
export type { HealthStatus, ILogger, LoggerMetrics } from './domain/interfaces/ILogger';
export { LogLevelVO } from './domain/value-objects/LogLevel';
export type { LogLevel } from './domain/value-objects/LogLevel';

