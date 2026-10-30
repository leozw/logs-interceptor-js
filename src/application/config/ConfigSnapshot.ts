import { detachedString } from '../../infrastructure/memory/DetachedString';

const CODE = 'ELVEN_CONFIG_INPUT_BUDGET';

/** Retain a bounded configuration snapshot, not caller maps/RegExp object graphs. */
export function configSnapshot<T>(input: T): T {
  let units = 65_536, nodes = 512;
  const seen = new WeakSet<object>();
  function text(value: string): string {
    if (value.length > 16_384 || value.length > units) throw new Error(CODE);
    units -= value.length;
    return detachedString(value, value.length);
  }
  function visit(value: unknown, depth: number, providers = false): unknown {
    if (--nodes < 0 || depth > 8) throw new Error(CODE);
    if (typeof value === 'string') return text(value);
    // Administrator-provided providers remain callbacks; their closures are caller-owned.
    if (typeof value === 'function' && !providers) throw new Error(CODE);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) throw new Error(CODE);
    seen.add(value);
    if (value instanceof RegExp) {
      const result = new RegExp(text(value.source), value.flags);
      seen.delete(value);
      return result;
    }
    if (Array.isArray(value)) {
      if (value.length > 64) throw new Error(CODE);
      const result = Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor && !('value' in descriptor)) throw new Error(CODE);
        return visit(descriptor?.value, depth + 1);
      });
      seen.delete(value);
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    let keys = 0;
    for (const key in value) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (++keys > 64 || !('value' in descriptor)) throw new Error(CODE);
      result[text(key)] = visit(descriptor.value, depth + 1, providers || (depth === 0 && key === 'dynamicLabels'));
    }
    seen.delete(value);
    return result;
  }
  try { return visit(input, 0) as T; }
  catch { throw new Error(CODE); }
}
