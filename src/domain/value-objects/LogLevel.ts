/**
 * Value Object: LogLevel
 * Represents a log level with validation
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export class LogLevelVO {
  private static readonly VALID_LEVELS: readonly LogLevel[] = [
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
  ] as const;

  private static readonly LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  };

  constructor(public readonly value: LogLevel) {
    if (!LogLevelVO.isValid(value)) {
      throw new Error(`Invalid log level: ${value}`);
    }
  }

  static isValid(level: string): level is LogLevel {
    return LogLevelVO.VALID_LEVELS.includes(level as LogLevel);
  }

  static fromString(level: string): LogLevelVO {
    const normalized = level.toLowerCase().trim();
    if (!LogLevelVO.isValid(normalized)) {
      throw new Error(`Invalid log level: ${level}`);
    }
    return new LogLevelVO(normalized);
  }

  compareTo(other: LogLevelVO): number {
    return (
      LogLevelVO.LEVEL_PRIORITY[this.value] -
      LogLevelVO.LEVEL_PRIORITY[other.value]
    );
  }

  isGreaterThanOrEqual(other: LogLevelVO): boolean {
    return this.compareTo(other) >= 0;
  }

  equals(other: LogLevelVO): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}



