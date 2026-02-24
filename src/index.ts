/**
 * Main Entry Point - Clean Architecture Implementation
 * Public API for logs-interceptor
 */
import { ConfigService, LogsInterceptorConfig } from './application';
import {
  HealthStatus,
  ILogger,
  LoggerMetrics,
} from './domain/interfaces/ILogger';
import { LogLevel } from './domain/value-objects/LogLevel';
import { ConsoleInterceptor } from './infrastructure/interceptors/ConsoleInterceptor';
import { LogsInterceptorFactory } from './presentation/factory/LogsInterceptorFactory';
import {
  internalDebug,
  internalError,
  loadConfigFromEnv,
  mergeConfigs,
  parseBool,
} from './utils';

export * from './infrastructure/integrations';

interface RuntimeState {
  logger: ILogger;
  consoleInterceptor?: ConsoleInterceptor;
}

let globalRuntime: RuntimeState | null = null;

/**
 * Initialize the logs interceptor with configuration
 * Can be called multiple times - subsequent calls will replace active runtime
 */
export function init(userConfig: Partial<LogsInterceptorConfig> = {}): ILogger {
  const envConfig = loadConfigFromEnv();
  const mergedConfig = mergeConfigs(userConfig, envConfig);

  const errors = ConfigService.validate(mergedConfig);
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  const resolvedConfig = ConfigService.resolve(mergedConfig as LogsInterceptorConfig);

  const previous = globalRuntime;
  if (previous) {
    previous.consoleInterceptor?.restore();
    void previous.logger.destroy().catch(() => {
      // Ignore cleanup error while replacing runtime
    });
  }

  const runtime = LogsInterceptorFactory.create(resolvedConfig);
  globalRuntime = runtime;

  return runtime.logger;
}

/**
 * Get the global logger instance
 * Throws an error if not initialized
 */
export function getLogger(): ILogger {
  if (!globalRuntime) {
    throw new Error('LogsInterceptor not initialized. Call init() first.');
  }

  return globalRuntime.logger;
}

/**
 * Check if the logger is initialized
 */
export function isInitialized(): boolean {
  return globalRuntime !== null;
}

/**
 * Destroy the global logger instance
 */
export async function destroy(): Promise<void> {
  if (!globalRuntime) {
    return;
  }

  const runtime = globalRuntime;
  globalRuntime = null;

  runtime.consoleInterceptor?.restore();
  await runtime.logger.destroy();
}

/**
 * Auto-initialize only when explicitly enabled
 */
function autoInitIfEnabled(): void {
  if (!parseBool(process.env.LOGS_AUTO_INIT, false)) {
    return;
  }

  const envConfig = loadConfigFromEnv();
  if (!envConfig.transport?.url || !envConfig.transport.tenantId || !envConfig.appName) {
    internalDebug('Auto-init skipped due to missing required LOGS_* variables');
    return;
  }

  try {
    init(envConfig);
    internalDebug('Auto-initialized from LOGS_* environment variables');
  } catch (error) {
    internalError('Auto-initialization failed', error);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    globalRuntime?.logger.debug(message, context);
  },

  info: (message: string, context?: Record<string, unknown>) => {
    globalRuntime?.logger.info(message, context);
  },

  warn: (message: string, context?: Record<string, unknown>) => {
    globalRuntime?.logger.warn(message, context);
  },

  error: (message: string, context?: Record<string, unknown>) => {
    globalRuntime?.logger.error(message, context);
  },

  log: (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    globalRuntime?.logger.log(level, message, context);
  },

  fatal: (message: string, context?: Record<string, unknown>) => {
    globalRuntime?.logger.fatal(message, context);
  },

  trackEvent: (eventName: string, properties?: Record<string, unknown>) => {
    globalRuntime?.logger.trackEvent(eventName, properties);
  },

  withContext: <T>(context: Record<string, unknown>, fn: () => T): T => {
    if (!globalRuntime) {
      throw new Error('LogsInterceptor not initialized');
    }

    return globalRuntime.logger.withContext(context, fn);
  },

  withContextAsync: async <T>(
    context: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T> => {
    if (!globalRuntime) {
      throw new Error('LogsInterceptor not initialized');
    }

    return globalRuntime.logger.withContextAsync(context, fn);
  },

  flush: async (): Promise<void> => {
    if (globalRuntime) {
      await globalRuntime.logger.flush();
    }
  },

  getMetrics: (): LoggerMetrics => {
    if (!globalRuntime) {
      throw new Error('LogsInterceptor not initialized');
    }

    return globalRuntime.logger.getMetrics();
  },

  getHealth: (): HealthStatus => {
    if (!globalRuntime) {
      throw new Error('LogsInterceptor not initialized');
    }

    return globalRuntime.logger.getHealth();
  },

  destroy: async (): Promise<void> => {
    await destroy();
  },
};

autoInitIfEnabled();

export default {
  init,
  getLogger,
  isInitialized,
  destroy,
  logger,
};

export type {
  LogsInterceptorConfig,
  ResolvedLogsInterceptorConfig,
} from './application/config/LogsInterceptorConfig';
export type { LogEntry, LogMetadata } from './domain/entities/LogEntry';
export type { HealthStatus, ILogger, LoggerMetrics } from './domain/interfaces/ILogger';
export { LogLevelVO } from './domain/value-objects/LogLevel';
export type { LogLevel } from './domain/value-objects/LogLevel';
