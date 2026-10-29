/**
 * Infrastructure: Log Filter Implementation
 */
import { ILogFilter } from '../../domain/interfaces/ILogFilter';
import type { LogLevel } from '../../domain/value-objects/LogLevel';
import { LogLevelVO } from '../../domain/value-objects/LogLevel';
import { LogEntry } from '../../domain/entities/LogEntry';
import { sanitizeData, detectSensitiveData, shouldSample } from '../../utils';
import { boundedSnapshot } from '../memory/BoundedSnapshot';
import { applyLabelPolicy } from './LabelPolicy';

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
        (pattern.lastIndex = 0, pattern.test(entry.message.slice(0, this.config.maxMessageLength)))
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
    let context = entry.context ? boundedSnapshot(entry.context) as Record<string, unknown> : undefined;
    if (this.config.sanitize && context) {
      context = sanitizeData(context, this.config.sensitivePatterns);
    }

    if (
      this.config.sanitize &&
      detectSensitiveData(message, this.config.sensitivePatterns)
    ) {
      message = '[REDACTED]';
    }

    const correlation = applyLabelPolicy(Object.fromEntries(
      Object.entries({ traceId: entry.traceId, spanId: entry.spanId, requestId: entry.requestId })
        .filter(([, value]) => value !== undefined),
    ), this.config);

    return {
      ...entry,
      ...correlation,
      message,
      context,
      labels: entry.labels ? applyLabelPolicy(entry.labels, this.config) : undefined,
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.config.levels.includes(level);
  }
}

