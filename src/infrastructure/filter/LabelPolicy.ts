import type { ResolvedLogsInterceptorConfig } from '../../application/config/LogsInterceptorConfig';
import { sanitizeData } from '../../utils';
import { boundedSnapshot } from '../memory/BoundedSnapshot';
import type { MatcherExecution } from '../privacy/MatcherPolicy';

type PrivacyPolicy = Pick<ResolvedLogsInterceptorConfig['filter'], 'sanitize' | 'sensitivePatterns'>;

/** Keep Resource and indexed log labels on the same detached, bounded policy. */
export function applyLabelPolicy(
  labels: Readonly<Record<string, unknown>> | undefined,
  policy: PrivacyPolicy,
  defaults: Readonly<Record<string, string>> = {},
  execution?: MatcherExecution,
): Record<string, string> {
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
    }
  }
  return result;
}
