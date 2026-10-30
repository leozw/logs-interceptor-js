import { detachedString } from './DetachedString';

export const LEGACY_CONFIG_LIMITS = Object.freeze({ units: 1_048_576, nodes: 500, depth: 8 });

/** Own persistent DTO strings; provider functions keep their caller-owned closures. */
export function ownedConfiguration<T>(input: T): T {
  let units = LEGACY_CONFIG_LIMITS.units;
  let nodes = LEGACY_CONFIG_LIMITS.nodes;
  let keys = LEGACY_CONFIG_LIMITS.nodes;
  const ancestors = new WeakSet<object>();
  const text = (value: string): string => {
    if (value.length > units) throw new Error('ELVEN_LEGACY_CONFIG_BUDGET');
    units -= value.length;
    return detachedString(value, value.length);
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (--nodes < 0 || depth > LEGACY_CONFIG_LIMITS.depth) throw new Error('ELVEN_LEGACY_CONFIG_BUDGET');
    if (typeof value === 'string') return text(value);
    if (value === null || typeof value !== 'object') return value;
    // The compiled matcher snapshots these; the logger does not retain the arrays.
    if (value instanceof RegExp) return value;
    if (ancestors.has(value)) throw new Error('ELVEN_LEGACY_CONFIG_UNSUPPORTED');
    ancestors.add(value);
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : Object.create(null);
    for (const key in value) {
      if (--keys < 0) throw new Error('ELVEN_LEGACY_CONFIG_BUDGET');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) continue;
      if (!('value' in descriptor)) throw new Error('ELVEN_LEGACY_CONFIG_UNSUPPORTED');
      Object.defineProperty(result, text(key), { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(value);
    return result;
  };
  return visit(input, 0) as T;
}
