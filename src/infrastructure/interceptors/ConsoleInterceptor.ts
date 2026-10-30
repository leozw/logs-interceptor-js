/**
 * Infrastructure: Console Interceptor Implementation
 */
import { ILogger } from '../../domain/interfaces/ILogger';
import { ILogInterceptor } from '../../domain/interfaces/ILogInterceptor';
import type { LogLevel } from '../../domain/value-objects/LogLevel';
import { safeStringify } from '../../utils';

export class ConsoleInterceptor implements ILogInterceptor {
  private enabled = false;
  private capturing = false;
  private wrappers: Partial<Record<'log' | 'info' | 'warn' | 'error' | 'debug', typeof console.log>> = {};
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
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
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

      const wrapper = (...args: unknown[]): void => {
        if (!this.enabled || this.capturing) { original(...args); return; }
        this.capturing = true;
        // Always intercept console logs - call logger directly
        // Call logger directly, bypassing intercept() to avoid stack trace issues
        try {
          const message = args.slice(0, 32)
            .map((arg) =>
              typeof arg === 'string' ? arg.slice(0, 8192) : safeStringify(arg)
            )
            .join(' ').slice(0, 8192);
          this.logger.log(level, message, { source: 'console' });
        } catch (error) {
          // If logger fails, still call original console
          original(...args);
          return;
        } finally {
          this.capturing = false;
        }

        // Call original console if preserveOriginal is true
        if (this.preserveOriginal) {
          original(...args);
        }
      };
      this.wrappers[method] = wrapper;
      console[method] = wrapper;
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
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      if (console[method] === this.wrappers[method]) console[method] = this.originalConsole[method];
    }
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

