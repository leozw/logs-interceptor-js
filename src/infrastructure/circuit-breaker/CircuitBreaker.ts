/**
 * Infrastructure: Circuit Breaker Implementation
 */
import {
  CircuitBreakerState,
  CircuitBreakerStateType,
  ICircuitBreaker,
} from '../../domain/interfaces/ICircuitBreaker';

export interface CircuitBreakerConfig {
  readonly enabled: boolean;
  readonly failureThreshold: number;
  readonly resetTimeout: number;
  readonly halfOpenRequests: number;
}

export class CircuitBreaker implements ICircuitBreaker {
  private state: CircuitBreakerStateType = 'closed';
  private failures = 0;
  private successCount = 0;
  private halfOpenInFlight = 0;
  private lastFailure?: number;
  private nextAttempt?: number;
  private lastError?: string;

  constructor(private readonly config: CircuitBreakerConfig) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.config.enabled) {
      return operation();
    }

    if (this.isOpen()) {
      throw new Error('Circuit breaker is open');
    }

    if (
      this.state === 'half-open' &&
      this.halfOpenInFlight >= this.config.halfOpenRequests
    ) {
      throw new Error('Circuit breaker half-open probe limit reached');
    }

    const countedAsProbe = this.state === 'half-open';
    if (countedAsProbe) {
      this.halfOpenInFlight++;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    } finally {
      if (countedAsProbe) {
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      }
    }
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;

      if (this.successCount >= this.config.halfOpenRequests) {
        this.state = 'closed';
        this.failures = 0;
        this.successCount = 0;
        this.halfOpenInFlight = 0;
        this.lastError = undefined;
      }

      return;
    }

    if (this.state === 'closed') {
      this.failures = 0;
      this.lastError = undefined;
    }
  }

  recordFailure(error?: Error): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (error) {
      this.lastError = error.message;
    }

    if (this.failures >= this.config.failureThreshold || this.state === 'half-open') {
      this.state = 'open';
      this.successCount = 0;
      this.halfOpenInFlight = 0;
      this.nextAttempt = Date.now() + this.config.resetTimeout;
    }
  }

  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failures: this.failures,
      successCount: this.successCount,
      halfOpenInFlight: this.halfOpenInFlight,
      lastFailure: this.lastFailure,
      nextAttempt: this.nextAttempt,
      lastError: this.lastError,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successCount = 0;
    this.halfOpenInFlight = 0;
    this.lastFailure = undefined;
    this.nextAttempt = undefined;
    this.lastError = undefined;
  }

  private isOpen(): boolean {
    if (this.state === 'open') {
      if (this.nextAttempt && Date.now() >= this.nextAttempt) {
        this.state = 'half-open';
        this.successCount = 0;
        this.halfOpenInFlight = 0;
        return false;
      }
      return true;
    }

    return false;
  }
}
