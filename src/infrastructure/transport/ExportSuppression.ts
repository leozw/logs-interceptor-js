import { AsyncLocalStorage } from 'node:async_hooks';

// OTel's context API can be a no-op in a standalone logger process.
export const logExportSuppression = new AsyncLocalStorage<boolean>();
