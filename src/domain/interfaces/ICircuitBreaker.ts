/**
 * Interface for circuit breaker pattern
 */
export interface ICircuitBreaker {
  /**
   * Execute an operation with circuit breaker protection
   */
  execute<T>(operation: () => Promise<T>): Promise<T>;

  /**
   * Record a successful operation
   */
  recordSuccess(): void;

  /**
   * Record a failed operation
   */
  recordFailure(error?: Error): void;

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState;

  /**
   * Reset the circuit breaker
   */
  reset(): void;
}

export type CircuitBreakerStateType = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  readonly state: CircuitBreakerStateType;
  readonly failures: number;
  readonly successCount: number;
  readonly halfOpenInFlight?: number;
  readonly lastFailure?: number;
  readonly nextAttempt?: number;
  readonly lastError?: string;
}


