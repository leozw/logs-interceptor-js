/** Materialize code units: slicing/concatenation alone can retain a huge V8 parent. */
export function detachedString(input: string, maxUnits: number): string {
  const limit = Math.max(0, Math.min(Math.floor(maxUnits), 1_048_576));
  return Buffer.from(input.slice(0, limit), 'utf16le').toString('utf16le');
}

export function detachedIdentifier(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const result = detachedString(input, 8192);
  return input.length > 8192 ? result + '...[truncated]' : result;
}
