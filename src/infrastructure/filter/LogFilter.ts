/**
 * Infrastructure: Log Filter Implementation
 */
import { ILogFilter } from '../../domain/interfaces/ILogFilter';
import type { LogLevel } from '../../domain/value-objects/LogLevel';
import { LogLevelVO } from '../../domain/value-objects/LogLevel';
import { LogEntry } from '../../domain/entities/LogEntry';
import { sanitizeData, detectSensitiveData, shouldSample } from '../../utils';

export interface LogFilterConfig {
  readonly levels: LogLevel[];
  readonly patterns: RegExp[];
  readonly samplingRate: number;
  readonly maxMessageLength: number;
  readonly sanitize: boolean;
  readonly sensitivePatterns: RegExp[];
}

export class LogFilter implements ILogFilter {
  constructor(private readonly config: LogFilterConfig) {}

  shouldProcess(entry: LogEntry): boolean {
    // Check if level is enabled
    if (!this.isLevelEnabled(entry.level)) {
      return false;
    }

    // Check message patterns
    if (this.config.patterns.length > 0) {
      const shouldInclude = this.config.patterns.some((pattern) =>
        pattern.test(entry.message)
      );
      if (!shouldInclude) {
        return false;
      }
    }

    // Apply sampling
    if (!shouldSample(this.config.samplingRate)) {
      return false;
    }

    return true;
  }

  filter(entry: LogEntry): LogEntry {
    // Truncate message if too long
    let message = entry.message;
    if (message.length > this.config.maxMessageLength) {
      message =
        message.substring(0, this.config.maxMessageLength) +
        '...[truncated]';
    }

    // Sanitize sensitive data
    let context = entry.context;
    if (this.config.sanitize && context) {
      context = sanitizeData(context, this.config.sensitivePatterns);
    }

    if (
      this.config.sanitize &&
      detectSensitiveData(message, this.config.sensitivePatterns)
    ) {
      message = '[REDACTED]';
    }

    return {
      ...entry,
      message,
      context,
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.config.levels.includes(level);
  }
}

