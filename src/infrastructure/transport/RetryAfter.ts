/** Parse only bounded HTTP Retry-After fields; never retain or report their values. */
export class RetryAfterDeclined extends Error {
  constructor() { super('ELVEN_RETRY_AFTER_DECLINED'); }
}

export function retryAfterNotBefore(
  field: string | string[] | undefined,
  wallNow = Date.now(),
  monotonicNow = performance.now(),
): { notBefore?: number; invalid: boolean } {
  if (field === undefined) return { invalid: false };
  const fields = Array.isArray(field) ? field : [field];
  let delay: number | undefined;
  let invalid = fields.length === 0 || fields.length > 8;
  for (const raw of fields.slice(0, 8)) {
    if (typeof raw !== 'string' || raw.length > 128) { invalid = true; continue; }
    const value = raw.replace(/^[\t ]+|[\t ]+$/g, '');
    if (/^[0-9]+$/.test(value)) {
      const seconds = Number(value);
      const milliseconds = Number.isSafeInteger(seconds) && Number.isSafeInteger(seconds * 1000) ? seconds * 1000 : Infinity;
      delay = Math.max(delay ?? 0, milliseconds);
    } else {
      const milliseconds = httpDate(value, wallNow);
      if (!Number.isFinite(milliseconds)) { invalid = true; continue; }
      delay = Math.max(delay ?? 0, milliseconds - wallNow, 0);
    }
  }
  if (delay === undefined) return { invalid };
  const target = monotonicNow + delay;
  return { notBefore: Number.isFinite(target) && target <= Number.MAX_SAFE_INTEGER ? target : Infinity, invalid };
}

function httpDate(value: string, wallNow: number): number {
  const imf = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  const obsolete = imf ? null : /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  const asctime = imf || obsolete ? null : /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) ( \d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(value);
  const fields = imf || obsolete;
  if (!fields && !asctime) return NaN;
  const day = Number(fields ? fields[1] : asctime![2]);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(fields ? fields[2] : asctime![1]);
  let year = Number(fields ? fields[3] : asctime![6]);
  let futureLimit = Infinity;
  if (obsolete) {
    // RFC850 uses a rolling fifty-year future window, not Date.parse's 1950 pivot.
    const limit = new Date(wallNow);
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    futureLimit = limit.getTime();
    const upper = limit.getUTCFullYear();
    year += Math.floor(upper / 100) * 100;
    if (year > upper) year -= 100;
  }
  const hour = Number(fields ? fields[4] : asctime![3]);
  const minute = Number(fields ? fields[5] : asctime![4]);
  const second = Number(fields ? fields[6] : asctime![5]);
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return NaN;
  const date = new Date(0);
  date.setUTCFullYear(year, month, day); date.setUTCHours(hour, minute, second, 0);
  if (obsolete && date.getTime() > futureLimit) { year -= 100; date.setUTCFullYear(year); }
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value.slice(0, 3));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day && date.getUTCDay() === weekday ? date.getTime() : NaN;
}
