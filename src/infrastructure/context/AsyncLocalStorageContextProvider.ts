/**
 * Infrastructure: AsyncLocalStorage Context Provider
 */
import { IContextProvider } from '../../domain/interfaces/IContextProvider';
import { AsyncLocalStorage } from 'async_hooks';

export class AsyncLocalStorageContextProvider implements IContextProvider {
  private readonly asyncLocalStorage = new AsyncLocalStorage<
    Record<string, unknown>
  >();

  getContext(): Record<string, unknown> {
    return this.asyncLocalStorage.getStore() ?? {};
  }

  runWithContext<T>(
    context: Record<string, unknown>,
    fn: () => T
  ): T {
    return this.asyncLocalStorage.run(context, fn);
  }

  async runWithContextAsync<T>(
    context: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.asyncLocalStorage.run(context, fn);
  }

  set(key: string, value: unknown): void {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      store[key] = value;
    }
  }

  get<T = unknown>(key: string): T | undefined {
    const store = this.asyncLocalStorage.getStore();
    return store?.[key] as T | undefined;
  }

  clear(): void {
    // AsyncLocalStorage doesn't have a clear method
    // Context is cleared when the async context ends
  }
}



