/**
 * Interface for context propagation
 */
export interface IContextProvider {
  /**
   * Get current context
   */
  getContext(): Record<string, unknown>;

  /**
   * Run a function with context
   */
  runWithContext<T>(context: Record<string, unknown>, fn: () => T): T;

  /**
   * Run an async function with context
   */
  runWithContextAsync<T>(
    context: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T>;

  /**
   * Set a value in the current context
   */
  set(key: string, value: unknown): void;

  /**
   * Get a value from the current context
   */
  get<T = unknown>(key: string): T | undefined;

  /**
   * Clear the current context
   */
  clear(): void;
}



