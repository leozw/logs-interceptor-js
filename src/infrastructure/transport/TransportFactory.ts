/**
 * Infrastructure: Transport Factory
 * Creates and configures the appropriate transport stack
 */
import { ResolvedLogsInterceptorConfig } from '../../application/config/LogsInterceptorConfig';
import { ICircuitBreaker } from '../../domain/interfaces/ICircuitBreaker';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import { ILogTransport } from '../../domain/interfaces/ILogTransport';
import { LokiJsonTransport } from './LokiJsonTransport';
import { LokiProtobufTransport } from './LokiProtobufTransport';
import { ResilientTransport } from './ResilientTransport';

export class TransportFactory {
  static create(
    config: ResolvedLogsInterceptorConfig,
    circuitBreaker?: ICircuitBreaker,
    dlq?: IDeadLetterQueue
  ): ILogTransport {
    const transportConfig = {
      ...config.transport,
      useWorkers: config.transport.useWorkers ?? config.performance.useWorkers,
      maxWorkers: config.transport.maxWorkers ?? config.performance.maxWorkers,
    };

    let baseTransport: ILogTransport;

    // Select transport based on compression/format
    // 'snappy' implies Protobuf transport as it's the native Loki format
    if (config.transport.compression === 'snappy') {
      console.log('[TransportFactory] Selected LokiProtobufTransport');
      baseTransport = new LokiProtobufTransport(transportConfig);
    } else {
      console.log('[TransportFactory] Selected LokiJsonTransport');
      baseTransport = new LokiJsonTransport(transportConfig);
    }

    // Wrap in resilience layer
    return new ResilientTransport(
      baseTransport,
      {
        maxRetries: config.transport.maxRetries,
        retryDelay: config.transport.retryDelay,
      },
      circuitBreaker,
      dlq
    );
  }
}
