import type { LogLevel } from '../value-objects/LogLevel';
import type { LogEntry } from '../entities/LogEntry';

/**
 * Interface for log filtering
 */
export interface ILogFilter {
  /**
   * Check if a log entry should be processed
   */
  shouldProcess(entry: LogEntry): boolean;

  /**
   * Filter and sanitize log entry
   */
  filter(entry: LogEntry): LogEntry;

  /**
   * Check if a level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean;
}

