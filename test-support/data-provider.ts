import { describe, test } from 'node:test';
import { format } from 'node:util';

type Arguments<T> = T extends readonly unknown[] ? [...T] : [T];

export function eachTest<T>(rows: readonly T[]) {
  return (title: string, fn: (...args: Arguments<T>) => void | Promise<void>): void => {
    for (const row of rows) {
      const values = (Array.isArray(row) ? row : [row]) as Arguments<T>;
      test(format(title, ...values), { concurrency: false }, () => fn(...values));
    }
  };
}

export function eachDescribe<T>(rows: readonly T[]) {
  return (title: string, fn: (row: T) => void): void => {
    for (const row of rows) describe(format(title, row), { concurrency: false }, () => fn(row));
  };
}
