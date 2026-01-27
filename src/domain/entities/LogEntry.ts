/**
 * Domain Entity: LogEntry
 * Represents a log entry in the system
 */
import type { LogLevel } from '../value-objects/LogLevel';

export interface LogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly requestId?: string;
  readonly labels?: Record<string, string>;
  readonly metadata?: LogMetadata;
}

export interface LogMetadata {
  readonly memoryUsage?: number;
  readonly cpuUsage?: number;
  readonly [key: string]: unknown;
}

export class LogEntryEntity {
  constructor(
    public readonly id: string,
    public readonly timestamp: string,
    public readonly level: LogLevel,
    public readonly message: string,
    public readonly context?: Record<string, unknown>,
    public readonly traceId?: string,
    public readonly spanId?: string,
    public readonly requestId?: string,
    public readonly labels?: Record<string, string>,
    public readonly metadata?: LogMetadata
  ) {}

  toJSON(): LogEntry {
    return {
      id: this.id,
      timestamp: this.timestamp,
      level: this.level,
      message: this.message,
      context: this.context,
      traceId: this.traceId,
      spanId: this.spanId,
      requestId: this.requestId,
      labels: this.labels,
      metadata: this.metadata,
    };
  }
}

