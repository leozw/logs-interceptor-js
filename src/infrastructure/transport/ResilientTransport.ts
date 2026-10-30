/**
 * Infrastructure: Resilient Transport Decorator
 * Adds Retry, Circuit Breaker, and DLQ capabilities to any transport
 */
import { LogEntry } from '../../domain/entities/LogEntry';
import { ICircuitBreaker } from '../../domain/interfaces/ICircuitBreaker';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import {
  ILogTransport,
  TransportHealth,
  TransportMetrics,
} from '../../domain/interfaces/ILogTransport';
import { internalWarn } from '../../utils';
import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import { logExportSuppression } from './ExportSuppression';
import { RetryAfterDeclined } from './RetryAfter';

export interface ResilientTransportConfig {
  maxRetries?: number;
  retryDelay?: number;
  sendTimeoutMillis?: number;
}

interface RetryableError extends Error {
  code?: string;
  statusCode?: number;
  retryable?: boolean;
  retryAfterNotBefore?: number;
}

export class ResilientTransport implements ILogTransport {
  private metrics: TransportMetrics = {
    totalSends: 0,
    successfulSends: 0,
    failedSends: 0,
    avgLatency: 0,
    retryAttempts: 0,
    retriedRequests: 0,
    dlqDroppedEntries: 0,
  };

  private lastDlqWarningAt = 0;
  private destroyed = false;
  private operations = new Set<AbortController>();
  private notBefore = 0;
  private lastInvalidHeaderAt = -Infinity;
  private lastHugeHeaderAt = -Infinity;

  constructor(
    private readonly transport: ILogTransport,
    private readonly config: ResilientTransportConfig,
    private readonly circuitBreaker?: ICircuitBreaker,
    private readonly dlq?: IDeadLetterQueue,
  ) {}

  async send(entries: LogEntry[]): Promise<void> {
    if (this.destroyed) throw new Error('Telemetry transport closed');
    if (entries.length === 0) {
      return;
    }

    this.metrics.totalSends++;

    const controller = new AbortController();
    const configured = this.config.sendTimeoutMillis ?? 30_000;
    const budget = Number.isFinite(configured) && configured >= 1 ? Math.min(60_000, configured) : 30_000;
    const deadline = performance.now() + budget;
    const timer = setTimeout(() => controller.abort(new Error('ELVEN_SEND_DEADLINE')), Math.ceil(budget));
    timer.unref();
    this.operations.add(controller);
    const operation = async () => logExportSuppression.run(true, () =>
      context.with(suppressTracing(context.active()), () => this.transport.send(entries, controller.signal,
        (notBefore, invalid) => this.observeRetryAfter(notBefore, invalid))));
    const operationWithRetry = async () => this.retryOperation(operation, deadline, controller.signal);

    try {
      if (this.circuitBreaker) {
        await this.circuitBreaker.execute(operationWithRetry);
      } else {
        await operationWithRetry();
      }

      controller.signal.throwIfAborted();
      this.metrics.successfulSends++;
    } catch (error) {
      const failure = controller.signal.aborted ? controller.signal.reason as Error : error as Error;
      this.metrics.failedSends++;
      this.metrics.failedSendEntries = (this.metrics.failedSendEntries ?? 0) + entries.length;
      if (failure?.message === 'ELVEN_SEND_DEADLINE') this.metrics.deadlineExceeded = (this.metrics.deadlineExceeded ?? 0) + 1;
      const retained = !this.destroyed ? await this.enqueueToDlq(entries, failure) : 0;
      this.metrics.dlqEnqueuedEntries = (this.metrics.dlqEnqueuedEntries ?? 0) + retained;
      this.metrics.unretainedSendEntries = (this.metrics.unretainedSendEntries ?? 0) + entries.length - retained;
      throw failure;
    } finally {
      clearTimeout(timer);
      this.operations.delete(controller);
    }
  }

  private async enqueueToDlq(entries: LogEntry[], error: Error): Promise<number> {
    if (!this.dlq) {
      return 0;
    }

    try {
      const result = await this.dlq.addBatch(entries, error.message);
      this.metrics.dlqDroppedEntries =
        (this.metrics.dlqDroppedEntries || 0) + result.dropped;
      return Math.max(0, Math.min(entries.length, result.added));
    } catch {
      const now = Date.now();
      if (now - this.lastDlqWarningAt > 10_000) {
        this.lastDlqWarningAt = now;
        internalWarn('ELVEN_DLQ_ENQUEUE_FAILED');
      }
      return 0;
    }
  }

  private observeRetryAfter(notBefore: number | undefined, invalid: boolean): void {
    if (notBefore !== undefined && !Number.isNaN(notBefore)) this.notBefore = Math.max(this.notBefore, notBefore);
    const now = performance.now();
    if (invalid && now - this.lastInvalidHeaderAt >= 10_000) {
      this.lastInvalidHeaderAt = now;
      internalWarn('ELVEN_INVALID_RETRY_AFTER');
    }
    if (notBefore === Infinity && now - this.lastHugeHeaderAt >= 10_000) {
      this.lastHugeHeaderAt = now;
      internalWarn('ELVEN_RETRY_AFTER_UNREPRESENTABLE');
    }
  }

  private async waitUntil(localFloor: number, deadline: number, signal: AbortSignal): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      const floor = Math.max(localFloor, this.notBefore);
      const now = performance.now();
      if (this.notBefore >= deadline) {
        this.metrics.backpressureDeclines = (this.metrics.backpressureDeclines ?? 0) + 1;
        throw new RetryAfterDeclined();
      }
      if (now >= deadline || localFloor >= deadline) throw new Error('ELVEN_SEND_DEADLINE');
      if (floor <= now) return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(signal.reason); };
        const timer = setTimeout(() => { cleanup(); resolve(); }, Math.ceil(floor - now));
        timer.unref();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      // A concurrent response may have raised the shared floor while we slept.
    }
  }

  private async retryOperation<T>(operation: () => Promise<T>, deadline: number, signal: AbortSignal): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 3;
    const delay = this.config.retryDelay ?? 1000;
    const totalAttempts = maxRetries + 1;

    let requestRetried = false;
    let localFloor = 0;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      if (this.destroyed) throw new Error('Telemetry transport closed');
      await this.waitUntil(localFloor, deadline, signal);
      if (attempt > 0) {
        if (!requestRetried) { requestRetried = true; this.metrics.retriedRequests = (this.metrics.retriedRequests ?? 0) + 1; }
        this.metrics.retryAttempts = (this.metrics.retryAttempts ?? 0) + 1;
      }
      try {
        const value = await operation();
        signal.throwIfAborted();
        return value;
      } catch (error) {
        signal.throwIfAborted();
        const typedError = error as RetryableError;
        this.observeRetryAfter(typedError.retryAfterNotBefore, false);
        if (this.notBefore >= deadline) {
          this.metrics.backpressureDeclines = (this.metrics.backpressureDeclines ?? 0) + 1;
          throw new RetryAfterDeclined();
        }
        const shouldRetry =
          attempt < totalAttempts - 1 && this.isRetryableError(typedError);

        if (!shouldRetry) {
          throw typedError;
        }

        const baseDelay = Math.min(30_000, delay * Math.pow(2, attempt));
        const jitter = Math.floor(Math.random() * 250);
        localFloor = performance.now() + baseDelay + jitter;
      }
    }

    throw new Error('Retry operation exhausted unexpectedly');
  }

  private isRetryableError(error: RetryableError): boolean {
    if (typeof error.retryable === 'boolean') {
      return error.retryable;
    }

    if (typeof error.statusCode === 'number') {
      return error.statusCode === 429 || error.statusCode >= 500;
    }

    const code = error.code || '';
    if (
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EPIPE',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_SOCKET',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT',
      ].includes(code)
    ) {
      return true;
    }

    const message = (error.message || '').toLowerCase();
    if (
      message.includes('timeout') ||
      message.includes('socket') ||
      message.includes('connect') ||
      message.includes('network') ||
      message.includes('429') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    ) {
      return true;
    }

    return false;
  }

  async isAvailable(): Promise<boolean> {
    return this.transport.isAvailable();
  }

  getHealth(): TransportHealth {
    const circuitBreakerState = this.circuitBreaker?.getState().state ?? 'closed';
    if (this.notBefore > performance.now()) return { healthy: false, circuitBreakerState, consecutiveFailures: this.metrics.failedSends, errorMessage: this.notBefore === Infinity ? 'ELVEN_RETRY_AFTER_UNREPRESENTABLE' : 'ELVEN_RETRY_AFTER_WAIT' };
    if (this.circuitBreaker) {
      const state = this.circuitBreaker.getState();
      if (state.state === 'open') {
        return {
          healthy: false,
          circuitBreakerState,
          consecutiveFailures: state.failures,
          errorMessage: `CircuitBreaker is OPEN. Last error: ${state.lastError}`,
        };
      }

      if (state.state === 'half-open') {
        return {
          healthy: true,
          circuitBreakerState,
          consecutiveFailures: state.failures,
          errorMessage: 'CircuitBreaker is HALF_OPEN',
        };
      }
    }

    return { ...this.transport.getHealth(), circuitBreakerState };
  }

  getMetrics(): TransportMetrics | undefined {
    const baseMetrics = this.transport.getMetrics();
    if (!baseMetrics) {
      return { ...this.metrics };
    }

    return {
      ...baseMetrics,
      ...this.metrics,
      avgLatency: baseMetrics.avgLatency,
      retryAttempts:
        (baseMetrics.retryAttempts || 0) + (this.metrics.retryAttempts || 0),
      retriedRequests:
        (baseMetrics.retriedRequests || 0) +
        (this.metrics.retriedRequests || 0),
      dlqDroppedEntries:
        (baseMetrics.dlqDroppedEntries || 0) +
        (this.metrics.dlqDroppedEntries || 0),
    };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const controller of this.operations) controller.abort(new Error('Telemetry transport closed'));
    await this.transport.destroy();
  }
}
