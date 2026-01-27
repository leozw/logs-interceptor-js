import { LogEntry } from '../entities/LogEntry';

/**
 * Repository interface for log persistence
 * Follows Repository Pattern
 */
export interface ILogRepository {
  /**
   * Save a log entry
   */
  save(entry: LogEntry): Promise<void>;

  /**
   * Save multiple log entries in batch
   */
  saveBatch(entries: LogEntry[]): Promise<void>;

  /**
   * Find logs by criteria
   */
  find(criteria: LogSearchCriteria): Promise<LogEntry[]>;

  /**
   * Get repository health
   */
  getHealth(): RepositoryHealth;
}

export interface LogSearchCriteria {
  level?: string;
  startTime?: Date;
  endTime?: Date;
  labels?: Record<string, string>;
  limit?: number;
}

export interface RepositoryHealth {
  readonly available: boolean;
  readonly error?: string;
}



