/** Snapshot application data without calling getters, toJSON or custom inspectors. */
export function boundedSnapshot(
  value: unknown,
  maxDepth = 8,
  maxBytes = 16_384,
): unknown {
  const seen = new WeakSet<object>();
  let remaining = Math.max(0, Math.min(maxBytes, 1_048_576));
  let nodes = 500;
  const text = (input: string): string => {
    const length = Math.max(
      0,
      Math.min(input.length, Math.floor(remaining / 6), 8192),
    );
    remaining -= length * 6;
    return length < input.length
      ? `${input.slice(0, length)}...[truncated]`
      : input;
  };
  const visit = (input: unknown, depth: number): unknown => {
    if (--nodes < 0 || remaining <= 0) return '[LIMIT_REACHED]';
    remaining -= 16;
    if (input === null || input === undefined) return null;
    if (typeof input === 'string') return text(input);
    if (typeof input === 'number')
      return Number.isFinite(input) ? input : String(input);
    if (typeof input === 'boolean') return input;
    if (typeof input === 'bigint') return text(`${input}n`);
    if (typeof input !== 'object') return `[${typeof input}]`;
    if (ArrayBuffer.isView(input))
      return `[${Buffer.isBuffer(input) ? 'Buffer' : 'TypedArray'}: ${input.byteLength} bytes]`;
    if (input instanceof ArrayBuffer)
      return `[ArrayBuffer: ${input.byteLength} bytes]`;
    if (depth >= maxDepth) return '[Max Depth Reached]';
    if (seen.has(input)) return '[Circular Reference]';
    seen.add(input);
    if (input instanceof Date)
      return Number.isFinite(input.getTime())
        ? input.toISOString()
        : '[Invalid Date]';
    if (input instanceof Map || input instanceof Set)
      return `[${input instanceof Map ? 'Map' : 'Set'}: ${input.size} entries]`;
    if (Array.isArray(input)) {
      const result: unknown[] = [];
      for (
        let i = 0;
        i < Math.min(input.length, 100) && nodes > 0 && remaining > 0;
        i++
      ) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
        result.push(
          descriptor && 'value' in descriptor
            ? visit(descriptor.value, depth + 1)
            : '[Accessor]',
        );
      }
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    // Enumerate incrementally: Object.entries would allocate every property up front.
    for (const key in input) {
      if (nodes <= 0 || remaining <= 0) {
        result._truncated = '[LIMIT_REACHED]';
        break;
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) continue;
      const safeKey = text(key);
      result[safeKey] =
        'value' in descriptor
          ? visit(descriptor.value, depth + 1)
          : '[Accessor]';
    }
    if (input instanceof Error) {
      for (const key of ['name', 'message', 'stack']) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (descriptor && 'value' in descriptor)
          result[key] = visit(descriptor.value, depth + 1);
      }
    }
    return result;
  };
  try {
    return visit(value, 0);
  } catch {
    return '[Unserializable]';
  }
}
