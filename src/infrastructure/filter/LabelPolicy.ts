import type { ResolvedLogsInterceptorConfig } from '../../application/config/LogsInterceptorConfig';
import { sanitizeData } from '../../utils';
import { boundedSnapshot } from '../memory/BoundedSnapshot';
import { MatcherPolicy, type MatcherExecution } from '../privacy/MatcherPolicy';

type PrivacyPolicy = Pick<ResolvedLogsInterceptorConfig['filter'], 'sanitize' | 'sensitivePatterns'>;

/** Keep Resource and indexed log labels on the same detached, bounded policy. */
export function applyLabelPolicy(
  labels: Readonly<Record<string, unknown>> | undefined,
  policy: PrivacyPolicy,
  defaults: Readonly<Record<string, string>> = {},
  execution?: MatcherExecution,
): Record<string, string> {
  if (!execution) {
    const matcher = new MatcherPolicy(policy);
    const scope = matcher.begin();
    try { return applyLabelPolicy(labels, policy, defaults, scope); }
    finally { scope.close(); matcher.close(); }
  }
  const detached = boundedSnapshot(labels);
  const combined: Record<string, unknown> = { ...defaults };
  if (detached && typeof detached === 'object' && !Array.isArray(detached)) {
    for (const [key, value] of Object.entries(detached)) {
      Object.defineProperty(combined, key, { value, enumerable: true, configurable: true });
    }
  }
  const filtered = policy.sanitize
    ? sanitizeData(combined, policy.sensitivePatterns, execution)
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
        const explicitlySensitive = execution.policy.sensitiveKey(key, execution) ||
          execution.policy.sensitiveKey(original, execution);
        if (!explicitlySensitive) result[key] = original;
      }
    }
  }
  return result;
}
