import { LogLevel } from '../value-objects/LogLevel';
import { LogEntry } from '../entities/LogEntry';

/**
 * Interface for log interceptor implementations
 */
export interface ILogInterceptor {
  /**
   * Intercept and process logs
   */
  intercept(level: LogLevel, message: string, context?: Record<string, unknown>): void;

  /**
   * Enable interception
   */
  enable(): void;

  /**
   * Disable interception
   */
  disable(): void;

  /**
   * Check if interception is enabled
   */
  isEnabled(): boolean;

  /**
   * Restore original behavior
   */
  restore(): void;
}



