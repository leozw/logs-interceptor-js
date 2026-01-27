/**
 * Infrastructure: Circuit Breaker Implementation
 */
import {
  ICircuitBreaker,
  CircuitBreakerState,
  CircuitBreakerStateType,
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
  private lastFailure?: number;
  private nextAttempt?: number;

  constructor(private readonly config: CircuitBreakerConfig) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.config.enabled) {
      return operation();
    }

    if (this.isOpen()) {
      throw new Error('Circuit breaker is open');
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.halfOpenRequests) {
        this.state = 'closed';
        this.failures = 0;
        this.successCount = 0;
      }
    } else if (this.state === 'closed') {
      this.failures = 0;
    }
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.config.failureThreshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.config.resetTimeout;
    }
  }

  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failures: this.failures,
      successCount: this.successCount,
      lastFailure: this.lastFailure,
      nextAttempt: this.nextAttempt,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successCount = 0;
    this.lastFailure = undefined;
    this.nextAttempt = undefined;
  }

  private isOpen(): boolean {
    if (this.state === 'open') {
      if (this.nextAttempt && Date.now() >= this.nextAttempt) {
        this.state = 'half-open';
        this.successCount = 0;
        return false;
      }
      return true;
    }
    return false;
  }
}



