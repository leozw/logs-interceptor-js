/**
 * Infrastructure: Resilient Transport Decorator
 * Adds Retry, Circuit Breaker, and DLQ capabilities to any transport
 */
import { LogEntry } from '../../domain/entities/LogEntry';
import { ICircuitBreaker } from '../../domain/interfaces/ICircuitBreaker';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import { ILogTransport, TransportHealth, TransportMetrics } from '../../domain/interfaces/ILogTransport';
import { RetryGate, sendScope } from './RetryPolicy';

export interface ResilientTransportConfig {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class ResilientTransport implements ILogTransport {
  private destroyed = false;
  private retryGate = new RetryGate();
  constructor(
    private readonly transport: ILogTransport,
    private readonly config: ResilientTransportConfig,
    private readonly circuitBreaker?: ICircuitBreaker,
    private readonly dlq?: IDeadLetterQueue
  ) { }

  async send(entries: LogEntry[], signal?: AbortSignal): Promise<void> {
    if (this.destroyed) throw new Error('Legacy transport closed');
    if (entries.length === 0) return;
    const retries = Number.isFinite(this.config.maxRetries) ? Math.floor(Math.min(20, Math.max(0, this.config.maxRetries!))) : 3;
    const delay = Number.isFinite(this.config.retryDelay) ? Math.min(30000, Math.max(0, this.config.retryDelay!)) : 1000;
    let budget = (this.config.timeout ?? 5000) * (retries + 1);
    for (let n = 0; n < retries; n++) budget += Math.min(30000, delay * Math.pow(2, n)) + 1000;
    const scope = sendScope(budget, [this.retryGate.signal(), ...(signal ? [signal] : [])]);
    const operation = async () => this.transport.send(entries, scope.signal);

    try {
      if (this.circuitBreaker) {
        await this.circuitBreaker.execute(() => this.retryOperation(operation, retries, delay, scope));
      } else {
        await this.retryOperation(operation, retries, delay, scope);
      }
    } catch (error) {
      if (this.destroyed) throw new Error('Legacy transport closed');
      // Send all failed logs to DLQ
      if (this.dlq && !this.destroyed) {
        await this.dlq.addBatch(entries, (error as Error).message).catch(() => {
          // Ignore DLQ errors to prevent loop
        });
      }
      throw error;
    } finally { scope.close(); }
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    delay: number,
    scope: ReturnType<typeof sendScope>
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.destroyed) throw new Error('Legacy transport closed');
      await this.retryGate.wait(scope.deadline, scope.signal);
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        this.retryGate.observe(error);
        if (this.destroyed) throw new Error('Legacy transport closed');
        scope.signal.throwIfAborted();

        if (attempt === maxRetries) {
          throw lastError;
        }

        const backoffDelay = Math.min(30000, delay * Math.pow(2, attempt));
        const jitter = Math.random() * 1000;
        await this.retryGate.wait(scope.deadline, scope.signal, backoffDelay + jitter);
      }
    }

    throw lastError!;
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
          rateLimitCodes: this.retryGate.diagnostics(),
        };
      }
    }
    const health = this.transport.getHealth();
    return { ...health, rateLimitCodes: [...new Set([...(health.rateLimitCodes ?? []), ...this.retryGate.diagnostics()])] };
  }

  getMetrics(): TransportMetrics | undefined {
    return this.transport.getMetrics();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.retryGate.close();
    await this.transport.destroy();
  }
}
