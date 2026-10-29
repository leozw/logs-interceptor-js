import type { ResolvedLogsInterceptorConfig } from '../../application/config/LogsInterceptorConfig';
import { sanitizeData } from '../../utils';
import { boundedSnapshot } from '../memory/BoundedSnapshot';

type PrivacyPolicy = Pick<ResolvedLogsInterceptorConfig['filter'], 'sanitize' | 'sensitivePatterns'>;

/** Keep Resource and indexed log labels on the same detached, bounded policy. */
export function applyLabelPolicy(
  labels: Readonly<Record<string, unknown>> | undefined,
  policy: PrivacyPolicy,
  defaults: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const detached = boundedSnapshot(labels);
  const combined: Record<string, unknown> = { ...defaults };
  if (detached && typeof detached === 'object' && !Array.isArray(detached)) {
    for (const [key, value] of Object.entries(detached)) {
      Object.defineProperty(combined, key, { value, enumerable: true, configurable: true });
    }
  }
  const filtered = policy.sanitize
    ? sanitizeData(combined, policy.sensitivePatterns)
    : boundedSnapshot(combined);
  const result: Record<string, string> = Object.create(null);
  if (filtered && typeof filtered === 'object' && !Array.isArray(filtered)) {
    for (const [key, value] of Object.entries(filtered)) {
      result[key] = typeof value === 'string' ? value
        : typeof value === 'number' || typeof value === 'boolean' ? String(value)
          : '[INVALID_LABEL_VALUE]';
      const original = combined[key];
      const correlation = key === 'trace_id' || key === 'traceId' ? /^[0-9a-f]{32}$/i
        : key === 'span_id' || key === 'spanId' ? /^[0-9a-f]{16}$/i : undefined;
      // Numeric hexadecimal span IDs are not payment-card fields. Explicit rules still win.
      if (policy.sanitize && correlation && typeof original === 'string' && correlation.test(original)) {
        const explicitlySensitive = policy.sensitivePatterns.some(pattern => {
          pattern.lastIndex = 0;
          if (pattern.test(key)) return true;
          pattern.lastIndex = 0;
          return pattern.test(original);
        });
        if (!explicitlySensitive) result[key] = original;
      }
    }
  }
  return result;
}
