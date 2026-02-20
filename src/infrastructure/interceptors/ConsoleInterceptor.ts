/**
 * Infrastructure: Console Interceptor Implementation
 */
import { ILogger } from '../../domain/interfaces/ILogger';
import { ILogInterceptor } from '../../domain/interfaces/ILogInterceptor';
import type { LogLevel } from '../../domain/value-objects/LogLevel';
import { safeStringify } from '../../utils';

export class ConsoleInterceptor implements ILogInterceptor {
  private enabled = false;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };

  constructor(
    private readonly logger: ILogger,
    private readonly preserveOriginal: boolean = true
  ) {
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };
  }

  intercept(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (!this.enabled) {
      return;
    }

    // Skip logs from logs-interceptor itself (only for internal calls, not console)
    const stack = new Error().stack || '';
    if (stack.includes('logs-interceptor') && !stack.includes('ConsoleInterceptor')) {
      if (this.preserveOriginal) {
        this.callOriginal(level, message, context);
      }
      return;
    }

    this.logger.log(level, message, context);

    if (this.preserveOriginal) {
      this.callOriginal(level, message, context);
    }
  }

  enable(): void {
    if (this.enabled) {
      return;
    }

    this.enabled = true;

    const methodMap: Record<string, LogLevel> = {
      log: 'info',
      info: 'info',
      warn: 'warn',
      error: 'error',
      debug: 'debug',
    };

    (['log', 'info', 'warn', 'error', 'debug'] as const).forEach((method) => {
      const original = this.originalConsole[method];
      const level = methodMap[method] as LogLevel;

      console[method] = (...args: unknown[]): void => {
        // Always intercept console logs - call logger directly
        // Call logger directly, bypassing intercept() to avoid stack trace issues
        try {
          const message = args
            .map((arg) =>
              typeof arg === 'string' ? arg : safeStringify(arg)
            )
            .join(' ');
          this.logger.log(level, message, { source: 'console' });
        } catch (error) {
          // If logger fails, still call original console
          original(...args);
          return;
        }

        // Call original console if preserveOriginal is true
        if (this.preserveOriginal) {
          original(...args);
        }
      };
    });
  }

  disable(): void {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;
    this.restore();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  restore(): void {
    console.log = this.originalConsole.log;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.debug = this.originalConsole.debug;
  }

  private callOriginal(
    level: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    const fullMessage = context
      ? `${message} ${safeStringify(context)}`
      : message;

    switch (level) {
      case 'debug':
        this.originalConsole.debug(fullMessage);
        break;
      case 'info':
        this.originalConsole.info(fullMessage);
        break;
      case 'warn':
        this.originalConsole.warn(fullMessage);
        break;
      case 'error':
        this.originalConsole.error(fullMessage);
        break;
      default:
        this.originalConsole.log(fullMessage);
    }
  }
}

