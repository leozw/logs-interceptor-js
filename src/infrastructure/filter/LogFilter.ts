/**
 * Infrastructure: Log Filter Implementation
 */
import { ILogFilter } from '../../domain/interfaces/ILogFilter';
import type { LogLevel } from '../../domain/value-objects/LogLevel';
import { LogEntry } from '../../domain/entities/LogEntry';
import {
  detectSensitiveData,
  safeStringify,
  sanitizeData,
  shouldSample,
} from '../../utils';
import { boundedSnapshot } from '../memory/BoundedSnapshot';
import { detachedIdentifier, detachedString } from '../memory/DetachedString';
import { applyLabelPolicy } from './LabelPolicy';
import { MatcherPolicy, type MatcherExecution } from '../privacy/MatcherPolicy';

export interface LogFilterConfig {
  readonly levels: LogLevel[];
  readonly patterns: RegExp[];
  readonly samplingRate: number;
  readonly maxMessageLength: number;
  readonly maxContextBytes: number;
  readonly sanitize: boolean;
  readonly sensitivePatterns: RegExp[];
}

export class LogFilter implements ILogFilter {
  private readonly matcher: MatcherPolicy;
  constructor(private readonly config: LogFilterConfig, matcher?: MatcherPolicy) {
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
    if (this.config.patterns.length > 0) {
      const shouldInclude = this.matcher.include(detachedString(entry.message, this.config.maxMessageLength), execution);
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
    let message = detachedString(entry.message, this.config.maxMessageLength);
    if (entry.message.length > this.config.maxMessageLength) message += '...[truncated]';

    // Sanitize sensitive data
    let context = entry.context
      ? boundedSnapshot(entry.context, 8, this.config.maxContextBytes) as Record<string, unknown>
      : undefined;
    if (this.config.sanitize && context) {
      context = sanitizeData(context, this.config.sensitivePatterns, execution);
    }

    if (context) {
      const serialized = safeStringify(context, 8);
      if (Buffer.byteLength(serialized, 'utf8') > this.config.maxContextBytes) {
        const preview = Buffer.from(serialized, 'utf8')
          .subarray(0, this.config.maxContextBytes)
          .toString('utf8');
        context = {
          _truncated: true,
          _reason: 'context_size_limit',
          preview,
        };
      }
    }

    if (
      this.config.sanitize &&
      detectSensitiveData(message, this.config.sensitivePatterns, execution)
    ) {
      message = '[REDACTED]';
    }

    return {
      ...entry,
      message,
      context,
      traceId: detachedIdentifier(entry.traceId),
      spanId: detachedIdentifier(entry.spanId),
      requestId: detachedIdentifier(entry.requestId),
      labels: entry.labels ? applyLabelPolicy(entry.labels, this.config, {}, execution) : undefined,
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.config.levels.includes(level);
  }
}
