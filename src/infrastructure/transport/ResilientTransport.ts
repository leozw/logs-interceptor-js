/**
 * Infrastructure: Resilient Transport Decorator
 * Adds Retry, Circuit Breaker, and DLQ capabilities to any transport
 */
import { LogEntry } from '../../domain/entities/LogEntry';
import { ICircuitBreaker } from '../../domain/interfaces/ICircuitBreaker';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import { ILogTransport, TransportHealth, TransportMetrics } from '../../domain/interfaces/ILogTransport';

export interface ResilientTransportConfig {
  maxRetries?: number;
  retryDelay?: number;
}

export class ResilientTransport implements ILogTransport {
  constructor(
    private readonly transport: ILogTransport,
    private readonly config: ResilientTransportConfig,
    private readonly circuitBreaker?: ICircuitBreaker,
    private readonly dlq?: IDeadLetterQueue
  ) { }

  async send(entries: LogEntry[]): Promise<void> {
    const operation = async () => this.transport.send(entries);

    try {
      if (this.circuitBreaker) {
        await this.circuitBreaker.execute(operation);
      } else {
        await this.retryOperation(operation);
      }
    } catch (error) {
      // Send all failed logs to DLQ
      if (this.dlq) {
        await this.dlq.addBatch(entries, (error as Error).message).catch(() => {
          // Ignore DLQ errors to prevent loop
        });
      }
      throw error;
    }
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = this.config.maxRetries ?? 3,
    delay: number = this.config.retryDelay ?? 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          throw lastError;
        }

        const backoffDelay = delay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        await new Promise((resolve) =>
          setTimeout(resolve, backoffDelay + jitter)
        );
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
        };
      }
    }
    return this.transport.getHealth();
  }

  getMetrics(): TransportMetrics | undefined {
    return this.transport.getMetrics();
  }

  async destroy(): Promise<void> {
    await this.transport.destroy();
  }
}
