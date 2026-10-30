import type { LogLevel } from '../value-objects/LogLevel';
import type { LogEntry } from '../entities/LogEntry';
import type { MatcherExecution } from '../../infrastructure/privacy/MatcherPolicy';

/**
 * Interface for log filtering
 */
export interface ILogFilter {
  /**
   * Check if a log entry should be processed
   */
  shouldProcess(entry: LogEntry, execution?: MatcherExecution): boolean;

  /**
   * Filter and sanitize log entry
   */
  filter(entry: LogEntry, execution?: MatcherExecution): LogEntry;
  beginRecord?(): MatcherExecution;
  privacyDiagnostics?(): readonly string[];
  close?(): void;

  /**
   * Check if a level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean;
}

