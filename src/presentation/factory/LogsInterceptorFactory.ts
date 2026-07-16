/**
 * Presentation: Factory for creating LogsInterceptor instances
 * Dependency Injection Container
 */
import { context, trace } from '@opentelemetry/api';
import { ResolvedLogsInterceptorConfig } from '../../application';
import { LogService } from '../../application/services/LogService';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import { ILogger } from '../../domain/interfaces/ILogger';
import { MemoryBuffer } from '../../infrastructure/buffer/MemoryBuffer';
import { CircuitBreaker } from '../../infrastructure/circuit-breaker/CircuitBreaker';
import { AsyncLocalStorageContextProvider } from '../../infrastructure/context/AsyncLocalStorageContextProvider';
import { FileDeadLetterQueue, MemoryDeadLetterQueue } from '../../infrastructure/dlq';
import { LogFilter } from '../../infrastructure/filter/LogFilter';
import { ConsoleInterceptor } from '../../infrastructure/interceptors/ConsoleInterceptor';
import { TransportFactory } from '../../infrastructure/transport/TransportFactory';

export class LogsInterceptorFactory {
  static create(config: ResolvedLogsInterceptorConfig): {
    logger: ILogger;
    consoleInterceptor?: ConsoleInterceptor;
  } {
    // Create context provider
    const contextProvider = new AsyncLocalStorageContextProvider();

    // Setup dynamic labels with OpenTelemetry support
    // Only include labels if they have valid values (not 'undefined')
    const dynamicLabels: Record<string, () => string | number> = {};

    // Trace ID
    dynamicLabels.trace_id = () => {
      const span = trace.getSpan(context.active());
      const traceId = span?.spanContext().traceId;
      return traceId || '';
    };

    // Span ID
    dynamicLabels.span_id = () => {
      const span = trace.getSpan(context.active());
      const spanId = span?.spanContext().spanId;
      return spanId || '';
    };

    // Request ID
    dynamicLabels.request_id = () => {
      return contextProvider.get<string>('requestId') || '';
    };

    // Merge with user-provided dynamic labels
    Object.assign(dynamicLabels, config.dynamicLabels);

    // Create circuit breaker
    const circuitBreaker = new CircuitBreaker(config.circuitBreaker);

    // Create Dead Letter Queue if enabled
    let dlq: IDeadLetterQueue | undefined;
    if (config.deadLetterQueue && config.deadLetterQueue.enabled !== false) {
      const dlqType = config.deadLetterQueue.type ?? 'memory';
      if (dlqType === 'file') {
        dlq = new FileDeadLetterQueue({
          maxSize: config.deadLetterQueue.maxSize,
          maxRetries: config.deadLetterQueue.maxRetries,
          basePath: config.deadLetterQueue.basePath,
        });
      } else {
        dlq = new MemoryDeadLetterQueue(
          config.deadLetterQueue.maxSize ?? 1000
        );
      }
    }

    // Create transport with all new features
    const transport = TransportFactory.create(
      config,
      circuitBreaker,
      dlq
    );

    // Create buffer
    const buffer = new MemoryBuffer(config.buffer);

    // Create filter
    const filter = new LogFilter(config.filter);

    // Create log service (this will setup the flush callback in buffer)
    const logger = new LogService(
      filter,
      buffer,
      transport,
      contextProvider,
      {
        appName: config.appName,
        version: config.version,
        environment: config.environment,
        labels: config.labels,
        dynamicLabels,
        enableMetrics: config.enableMetrics,
        maxConcurrentFlushes: config.performance.maxConcurrentFlushes,
        maxPendingBatches: config.performance.maxPendingBatches,
      }
    );

    // Create console interceptor if enabled
    let consoleInterceptor: ConsoleInterceptor | undefined;
    if (config.interceptConsole) {
      consoleInterceptor = new ConsoleInterceptor(
        logger,
        config.preserveOriginalConsole
      );
      consoleInterceptor.enable();
    }

    // Ensure direct logger.destroy() also restores console methods.
    const originalDestroy = logger.destroy.bind(logger);
    logger.destroy = async () => {
      consoleInterceptor?.restore();
      await originalDestroy();
    };

    return { logger, consoleInterceptor };
  }
}
