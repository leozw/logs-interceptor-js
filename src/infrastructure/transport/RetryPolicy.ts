import { detachedString } from '../memory/DetachedString';

type Header = string | string[] | undefined;
export const RETRY_CODES = Object.freeze({ invalid: 'ELVEN_RETRY_AFTER_INVALID', huge: 'ELVEN_RETRY_AFTER_UNREPRESENTABLE', deadline: 'ELVEN_LEGACY_SEND_DEADLINE', cancelled: 'ELVEN_LEGACY_SEND_CANCELLED' });
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function trimOWS(value: string): string {
  let start = 0, end = value.length;
  while (start < end && (value.charCodeAt(start) === 32 || value.charCodeAt(start) === 9)) start++;
  while (end > start && (value.charCodeAt(end - 1) === 32 || value.charCodeAt(end - 1) === 9)) end--;
  return value.slice(start, end);
}

function date(value: Header, wall: number): number | undefined {
  if (typeof value !== 'string' || value.length > 128) return undefined;
  const owned = trimOWS(detachedString(value, 128));
  let parts: string[] | null = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(owned);
  let obsolete = false;
  if (!parts) {
    parts = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(owned);
    obsolete = !!parts;
  }
  if (!parts) {
    const ascii = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Z][a-z]{2}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(owned);
    if (ascii) parts = [ascii[0], ascii[1], ascii[3], ascii[2], ascii[7], ascii[4], ascii[5], ascii[6]];
  }
  if (!parts) return undefined;
  let year = Number(parts[4]);
  if (obsolete) year += Math.floor(new Date(wall).getUTCFullYear() / 100) * 100;
  const month = months.indexOf(parts[3]), day = Number(parts[2]);
  const hour = Number(parts[5]), minute = Number(parts[6]), second = Number(parts[7]);
  const result = new Date(0); result.setUTCFullYear(year, month, day); result.setUTCHours(hour, minute, second, 0);
  if (obsolete) {
    const cutoff = new Date(wall); cutoff.setUTCFullYear(cutoff.getUTCFullYear() + 50);
    if (result.getTime() > cutoff.getTime()) { year -= 100; result.setUTCFullYear(year, month, day); }
  }
  return month >= 0 && result.getUTCFullYear() === year && result.getUTCMonth() === month && result.getUTCDate() === day && result.getUTCHours() === hour && result.getUTCMinutes() === minute && result.getUTCSeconds() === second && weekdays[result.getUTCDay()] === parts[1].slice(0, 3) ? result.getTime() : undefined;
}

/** Separate header fields only: a comma can belong to an HTTP-date. */
export function parseRetryAfter(value: Header, wall = Date.now()): { delay: number; invalid: boolean; huge: boolean } {
  if (value === undefined) return { delay: 0, invalid: false, huge: false };
  const fields = Array.isArray(value) ? value : [value];
  if (fields.length === 0 || fields.length > 16 || fields.reduce((n, v) => n + v.length, 0) > 4096) return { delay: 0, invalid: true, huge: false };
  let delay = 0, invalid = false, huge = false;
  for (const raw of fields) {
    if (raw.length > 1024) { invalid = true; continue; }
    const field = trimOWS(detachedString(raw, raw.length));
    let digits = field.length > 0;
    for (let n = 0; n < field.length; n++) if (field.charCodeAt(n) < 48 || field.charCodeAt(n) > 57) digits = false;
    if (digits) {
      const seconds = Number(field);
      if (!Number.isFinite(seconds) || seconds > Number.MAX_SAFE_INTEGER / 1000) huge = true;
      else delay = Math.max(delay, seconds * 1000);
    } else {
      const timestamp = date(field, wall);
      if (timestamp === undefined) invalid = true;
      else delay = Math.max(delay, timestamp - wall);
    }
  }
  return { delay: Math.max(0, delay), invalid, huge };
}

export class RetryAfterError extends Error {
  constructor(status: number, readonly notBefore: number, readonly invalid: boolean, readonly huge: boolean) { super(`Loki responded with ${status}`); }
}

export function responseError(status: number, headers: Record<string, Header>, localBackoff: number): RetryAfterError {
  const parsed = parseRetryAfter(headers['retry-after']);
  const fallback = Number.isFinite(localBackoff) ? localBackoff : 1000;
  const delay = Math.max(parsed.delay, parsed.invalid ? Math.max(1, Math.min(30000, fallback)) : 0);
  const notBefore = delay > 0 ? Math.ceil(performance.now() + delay) : 0;
  return new RetryAfterError(status, Number.isSafeInteger(notBefore) ? notBefore : 0, parsed.invalid, parsed.huge || !Number.isSafeInteger(notBefore));
}

export function sendScope(milliseconds: number, parents: AbortSignal[] = []): { deadline: number; signal: AbortSignal; close: () => void } {
  if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647) throw new Error(RETRY_CODES.deadline);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error(RETRY_CODES.cancelled));
  const timer = setTimeout(() => controller.abort(new Error(RETRY_CODES.deadline)), milliseconds);
  for (const signal of parents) { signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel(); }
  return { deadline: performance.now() + milliseconds, signal: controller.signal, close() { clearTimeout(timer); for (const signal of parents) signal.removeEventListener('abort', cancel); } };
}

export class RetryGate {
  private notBefore = 0;
  private degraded = false;
  private codes = new Set<string>();
  private lifecycle = new AbortController();
  signal(): AbortSignal { return this.lifecycle.signal; }
  diagnostics(): readonly string[] { return [...this.codes]; }
  observe(error: unknown): void {
    if (!(error instanceof RetryAfterError)) return;
    this.notBefore = Math.max(this.notBefore, error.notBefore);
    if (error.invalid) this.codes.add(RETRY_CODES.invalid);
    if (error.huge) { this.degraded = true; this.codes.add(RETRY_CODES.huge); }
  }
  async wait(deadline: number, signal: AbortSignal, localBackoff = 0): Promise<void> {
    const localFloor = performance.now() + localBackoff;
    for (;;) {
      signal.throwIfAborted();
      if (this.degraded) throw new Error(RETRY_CODES.huge);
      const now = performance.now(), delay = Math.ceil(Math.max(this.notBefore, localFloor) - now);
      if (now >= deadline || delay >= deadline - now) throw new Error(RETRY_CODES.deadline);
      if (delay <= 0) return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
        const cancel = () => { cleanup(); reject(signal.reason); };
        const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
        signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
      });
    }
  }
  async dispatch<T>(deadline: number, signal: AbortSignal, invoke: () => Promise<T>): Promise<T> {
    for (;;) {
      await this.wait(deadline, signal);
      // A different send can install a floor while the awaited wait resolves.
      signal.throwIfAborted();
      if (this.degraded) throw new Error(RETRY_CODES.huge);
      const now = performance.now();
      if (now >= deadline) throw new Error(RETRY_CODES.deadline);
      if (this.notBefore > now) continue;
      return invoke();
    }
  }
  close(): void { this.lifecycle.abort(new Error(RETRY_CODES.cancelled)); }
}
