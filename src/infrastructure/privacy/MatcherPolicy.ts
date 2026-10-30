export interface MatcherCall {
  readonly failed: boolean;
  close(): void;
}
export interface MatcherExecution {
  readonly policy: MatcherPolicy;
  readonly call: MatcherCall;
  close(): void;
}
interface FilterPolicy {
  readonly sensitivePatterns: RegExp[];
  readonly patterns?: RegExp[];
  readonly sanitize: boolean;
}
interface CorePolicy {
  begin(): MatcherCall;
  privacy(value: string, call: MatcherCall): boolean;
  sensitiveKey(value: string, call: MatcherCall): boolean;
  include(value: string, call: MatcherCall): boolean;
  close(): void;
  toJSON(): { ready: boolean; codes: string[] };
}
// The portable core is also independently regression-tested as plain CJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('./matcher-core.cjs') as {
  Policy: new (options: {
    sensitive: RegExp[]; selectors: RegExp[]; builtins: RegExp[]; sanitize: boolean;
  }) => CorePolicy;
  BUILTINS: RegExp[];
  normalize(pattern: RegExp): { cost: number; source: string };
  LIMITS: { rulesPerRole: number; expandedTotal: number; normalizedTotal: number };
};

export function validateMatcherPatterns(patterns: RegExp[]): boolean {
  try {
    if (!Array.isArray(patterns) || patterns.length > core.LIMITS.rulesPerRole) return false;
    let cost = 0, units = 0;
    for (const pattern of patterns) {
      const plan = core.normalize(pattern);
      cost += plan.cost; units += plan.source.length;
      if (cost > core.LIMITS.expandedTotal || units > core.LIMITS.normalizedTotal) return false;
    }
    return true;
  } catch { return false; }
}

export class MatcherPolicy {
  private readonly core: CorePolicy;
  constructor(config: FilterPolicy) {
    this.core = new core.Policy({
      sensitive: config.sensitivePatterns, selectors: config.patterns ?? [],
      builtins: core.BUILTINS, sanitize: config.sanitize,
    });
  }
  assertReady(): void {
    const state = this.core.toJSON();
    if (!state.ready) {
      const code = state.codes[0] ?? 'ELVEN_MATCHER_BACKEND_FAILURE';
      this.close();
      throw new Error(code);
    }
  }
  begin(): MatcherExecution {
    const call = this.core.begin();
    return { policy: this, call, close: () => call.close() };
  }
  sensitive(value: string, execution: MatcherExecution): boolean { return this.core.privacy(value, execution.call); }
  sensitiveKey(value: string, execution: MatcherExecution): boolean { return this.core.sensitiveKey(value, execution.call); }
  include(value: string, execution: MatcherExecution): boolean { return this.core.include(value, execution.call); }
  diagnostics(): readonly string[] { return this.core.toJSON().codes; }
  close(): void { this.core.close(); }
}
