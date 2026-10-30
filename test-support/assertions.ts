import assert from 'node:assert/strict';

function numeric(value: unknown): value is number | bigint {
  return typeof value === 'number' || typeof value === 'bigint';
}

export function greaterOrEqual(actual: unknown, expected: unknown): void {
  assert.ok(numeric(actual) && numeric(expected) && actual >= expected);
}

export function lessThan(actual: unknown, expected: unknown): void {
  assert.ok(numeric(actual) && numeric(expected) && actual < expected);
}

function thrownMessage(value: unknown): string {
  if (value !== null && value !== undefined && typeof (value as { message?: unknown }).message === 'string') {
    return (value as { message: string }).message;
  }
  return String(value);
}

export function throwsContaining(fn: () => unknown, fragment: string): void {
  assert.throws(fn, value => thrownMessage(value).includes(fragment));
}

function errorObject(value: unknown): boolean {
  return ['[object Error]', '[object Exception]', '[object DOMException]'].includes(Object.prototype.toString.call(value)) || value instanceof Error;
}

// Preserve the used Jest rejects.toThrow(any/string) contract, including cross-realm errors.
export function rejectsToThrow(promise: Promise<unknown>, fragment?: string): Promise<void> {
  return assert.rejects(promise, reason => {
    let thrown = reason;
    if (!errorObject(reason)) {
      if (typeof reason !== 'function') return false;
      try { reason(); return false; } catch (value) { thrown = value; }
    }
    return fragment === undefined || thrownMessage(thrown).includes(fragment);
  });
}
