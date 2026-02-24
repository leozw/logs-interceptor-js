/**
 * Infrastructure: Morgan Middleware Adapter
 * Capture HTTP access logs from Morgan
 */
import { ILogger } from '../../domain/interfaces/ILogger';

export class MorganAdapter {
  static createStream(logger: ILogger) {
    return {
      write: (message: string) => {
        // Morgan messages often end with newline
        const cleanMessage = message.trim();
        if (cleanMessage) {
          logger.info(cleanMessage, { source: 'morgan', type: 'access_log' });
        }
      },
    };
  }

  static create(format: string, logger: ILogger) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const morgan = require('morgan') as (
      fmt: string,
      options: { stream: { write: (message: string) => void } }
    ) => any;
    return morgan(format, { stream: this.createStream(logger) });
  }
}
