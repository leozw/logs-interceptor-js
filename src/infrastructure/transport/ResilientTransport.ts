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

export interface ResilientTransportConfig {
  maxRetries?: number;
  retryDelay?: number;
}

interface RetryableError extends Error {
  code?: string;
  statusCode?: number;
  retryable?: boolean;
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

  constructor(
    private readonly transport: ILogTransport,
    private readonly config: ResilientTransportConfig,
    private readonly circuitBreaker?: ICircuitBreaker,
    private readonly dlq?: IDeadLetterQueue
  ) {}

  async send(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    this.metrics.totalSends++;

    const operation = async () => this.transport.send(entries);
    const operationWithRetry = async () => this.retryOperation(operation);

    try {
      if (this.circuitBreaker) {
        await this.circuitBreaker.execute(operationWithRetry);
      } else {
        await operationWithRetry();
      }

      this.metrics.successfulSends++;
    } catch (error) {
      this.metrics.failedSends++;
      await this.enqueueToDlq(entries, error as Error);
      throw error;
    }
  }

  private async enqueueToDlq(entries: LogEntry[], error: Error): Promise<void> {
    if (!this.dlq) {
      return;
    }

    try {
      const result = await this.dlq.addBatch(entries, error.message);
      this.metrics.dlqDroppedEntries =
        (this.metrics.dlqDroppedEntries || 0) + result.dropped;
    } catch (dlqError) {
      const now = Date.now();
      if (now - this.lastDlqWarningAt > 10_000) {
        this.lastDlqWarningAt = now;
        internalWarn('Failed to enqueue logs to DLQ', dlqError);
      }
    }
  }

  private async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 3;
    const delay = this.config.retryDelay ?? 1000;
    const totalAttempts = maxRetries + 1;

    let requestRetried = false;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const typedError = error as RetryableError;
        const shouldRetry =
          attempt < totalAttempts - 1 && this.isRetryableError(typedError);

        if (!shouldRetry) {
          throw typedError;
        }

        if (!requestRetried) {
          requestRetried = true;
          this.metrics.retriedRequests = (this.metrics.retriedRequests || 0) + 1;
        }

        this.metrics.retryAttempts = (this.metrics.retryAttempts || 0) + 1;

        const baseDelay = delay * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
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
    if (this.circuitBreaker) {
      const state = this.circuitBreaker.getState();
      if (state.state === 'open') {
        return {
          healthy: false,
          consecutiveFailures: state.failures,
          errorMessage: `CircuitBreaker is OPEN. Last error: ${state.lastError}`,
        };
      }

      if (state.state === 'half-open') {
        return {
          healthy: true,
          consecutiveFailures: state.failures,
          errorMessage: 'CircuitBreaker is HALF_OPEN',
        };
      }
    }

    return this.transport.getHealth();
  }

  getMetrics(): TransportMetrics | undefined {
    const baseMetrics = this.transport.getMetrics();
    if (!baseMetrics) {
      return { ...this.metrics };
    }

    return {
      ...baseMetrics,
      retryAttempts:
        (baseMetrics.retryAttempts || 0) + (this.metrics.retryAttempts || 0),
      retriedRequests:
        (baseMetrics.retriedRequests || 0) + (this.metrics.retriedRequests || 0),
      dlqDroppedEntries:
        (baseMetrics.dlqDroppedEntries || 0) +
        (this.metrics.dlqDroppedEntries || 0),
    };
  }

  async destroy(): Promise<void> {
    await this.transport.destroy();
  }
}
