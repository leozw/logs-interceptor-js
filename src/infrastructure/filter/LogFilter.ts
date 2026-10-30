/**
 * Infrastructure: Log Filter Implementation
 */
import { ILogFilter } from '../../domain/interfaces/ILogFilter';
import type { LogLevel } from '../../domain/value-objects/LogLevel';
import { LogEntry } from '../../domain/entities/LogEntry';
import { sanitizeData, detectSensitiveData, shouldSample } from '../../utils';
import { boundedSnapshot } from '../memory/BoundedSnapshot';
import { applyLabelPolicy } from './LabelPolicy';
import { MatcherPolicy, type MatcherExecution } from '../privacy/MatcherPolicy';

export interface LogFilterConfig {
  readonly levels: LogLevel[];
  readonly patterns: RegExp[];
  readonly samplingRate: number;
  readonly maxMessageLength: number;
  readonly sanitize: boolean;
  readonly sensitivePatterns: RegExp[];
}

export class LogFilter implements ILogFilter {
  private readonly matcher: MatcherPolicy;
  private readonly hasSelectors: boolean;
  constructor(private readonly config: LogFilterConfig, matcher?: MatcherPolicy) {
    this.hasSelectors = config.patterns.length > 0;
    this.matcher = matcher ?? new MatcherPolicy(config);
    this.matcher.assertReady();
  }
  beginRecord(): MatcherExecution { return this.matcher.begin(); }
  privacyDiagnostics(): readonly string[] { return this.matcher.diagnostics(); }
  close(): void { this.matcher.close(); }

  shouldProcess(entry: LogEntry, execution?: MatcherExecution): boolean {
    if (!execution) {
      const scope = this.beginRecord();
      try { return this.shouldProcess(entry, scope); } finally { scope.close(); }
    }
    // Check if level is enabled
    if (!this.isLevelEnabled(entry.level)) {
      return false;
    }

    // Check message patterns
    if (this.hasSelectors) {
      const shouldInclude = this.matcher.include(entry.message.slice(0, this.config.maxMessageLength), execution);
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

  filter(entry: LogEntry, execution?: MatcherExecution): LogEntry {
    if (!execution) {
      const scope = this.beginRecord();
      try { return this.filter(entry, scope); } finally { scope.close(); }
    }
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
      context = sanitizeData(context, this.config.sensitivePatterns, execution);
    }

    if (
      this.config.sanitize &&
      detectSensitiveData(message, this.config.sensitivePatterns, execution)
    ) {
      message = '[REDACTED]';
    }

    const correlation = applyLabelPolicy(Object.fromEntries(
      Object.entries({ traceId: entry.traceId, spanId: entry.spanId, requestId: entry.requestId })
        .filter(([, value]) => value !== undefined),
    ), this.config, {}, execution);

    return {
      ...entry,
      ...correlation,
      message,
      context,
      labels: entry.labels ? applyLabelPolicy(entry.labels, this.config, {}, execution) : undefined,
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.config.levels.includes(level);
  }
}

