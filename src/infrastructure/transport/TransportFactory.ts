/**
 * Infrastructure: Transport Factory
 * Creates and configures the appropriate transport stack
 */
import { ResolvedLogsInterceptorConfig } from '../../application/config/LogsInterceptorConfig';
import { ICircuitBreaker } from '../../domain/interfaces/ICircuitBreaker';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import { ILogTransport } from '../../domain/interfaces/ILogTransport';
import { internalDebug } from '../../utils';
import { LokiJsonTransport } from './LokiJsonTransport';
import { OtlpHttpTransport } from './OtlpHttpTransport';
import { ResilientTransport } from './ResilientTransport';
import type { MatcherPolicy } from '../privacy/MatcherPolicy';

export class TransportFactory {
  static create(
    config: ResolvedLogsInterceptorConfig,
    circuitBreaker?: ICircuitBreaker,
    dlq?: IDeadLetterQueue,
    matcher?: MatcherPolicy
  ): ILogTransport {
    const transportConfig = {
      ...config.transport,
      useWorkers: config.transport.useWorkers ?? config.performance.useWorkers,
      maxWorkers: config.transport.maxWorkers ?? config.performance.maxWorkers,
      workerTimeout:
        config.transport.workerTimeout ?? config.performance.workerTimeout,
    };

    let baseTransport: ILogTransport;

    if (config.transport.type === 'otlp') {
      internalDebug('Selected OtlpHttpTransport');
      baseTransport = new OtlpHttpTransport(config, matcher);
    } else if (config.transport.compression === 'snappy') {
      // Lazy import to avoid loading native snappy bindings when not needed.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { LokiProtobufTransport } = require('./LokiProtobufTransport') as {
        LokiProtobufTransport: new (...args: any[]) => ILogTransport;
      };
      internalDebug('Selected LokiProtobufTransport');
      baseTransport = new LokiProtobufTransport(transportConfig, config.transport.headers);
    } else {
      internalDebug('Selected LokiJsonTransport');
      baseTransport = new LokiJsonTransport(transportConfig, config.transport.headers);
    }

    return new ResilientTransport(
      baseTransport,
      {
        maxRetries: config.transport.maxRetries,
        retryDelay: config.transport.retryDelay,
        sendTimeoutMillis: config.transport.sendTimeoutMillis,
      },
      circuitBreaker,
      dlq
    );
  }
}
