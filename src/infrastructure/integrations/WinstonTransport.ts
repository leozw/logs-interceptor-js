/**
 * Infrastructure: Winston Transport Adapter
 * Allows Winston to send logs through the Logs Interceptor pipeline
 */
import TransportStream from 'winston-transport';
import { ILogger } from '../../domain/interfaces/ILogger';

export interface WinstonTransportOptions extends TransportStream.TransportStreamOptions {
  logger: ILogger;
}

export class WinstonTransport extends TransportStream {
  private readonly logger: ILogger;

  constructor(opts: WinstonTransportOptions) {
    super(opts);
    this.logger = opts.logger;
  }

  log(info: any, callback: () => void): void {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const { level, message, ...meta } = info;

    // Map Winston levels to our levels
    // Winston: error: 0, warn: 1, info: 2, http: 3, verbose: 4, debug: 5, silly: 6
    // We map roughly to fatal, error, warn, info, debug

    // Extract potential error object from meta
    let context: Record<string, unknown> | undefined = meta;

    // If meta has Splat/Symbol(splat), we might want to clean it up, 
    // but for now passing meta as context is standard.

    switch (level) {
      case 'error':
        this.logger.error(message, context);
        break;
      case 'warn':
        this.logger.warn(message, context);
        break;
      case 'info':
        this.logger.info(message, context);
        break;
      case 'debug':
      case 'silly':
      case 'verbose':
        this.logger.debug(message, context);
        break;
      default:
        this.logger.info(message, context);
    }

    callback();
  }
}
