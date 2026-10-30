/**
 * Node-RED Node Implementation
 * Custom node for logs-interceptor
 */
import { safeStringify } from '../../utils';
import { boundedSnapshot } from '../../infrastructure/memory/BoundedSnapshot';

// Type declarations for Node.js globals in Node-RED context
declare const require: (id: string) => any;
declare const process: {
  env: Record<string, string | undefined>;
};

interface NodeRedNode {
  id: string;
  type: string;
  name: string;
  wires: string[][];
}

interface NodeRedConfig {
  url: string;
  tenantId: string;
  authToken?: string;
  appName: string;
  environment?: string;
  version?: string;
  interceptConsole?: boolean;
  debug?: boolean;
}

interface NodeRedMessage {
  payload: unknown;
  topic?: string;
  [key: string]: unknown;
}

export = function (RED: any) {
  'use strict';

  function LogsInterceptorNode(this: any, config: NodeRedNode & NodeRedConfig) {
    RED.nodes.createNode(this, config);

    let logger: any = null;
    let initialized = false;

    // Initialize logger
    try {
      // Try to load from dist (production) or src (development)
      const logsInterceptor: any = require('../../index');
      const { init } = logsInterceptor;
      
      // Get process.env safely
      const env = typeof process !== 'undefined' ? process.env : {};
      
      const loggerConfig = {
        transport: {
          url: config.url || (env.LOGS_INTERCEPTOR_URL as string),
          tenantId: config.tenantId || (env.LOGS_INTERCEPTOR_TENANT_ID as string),
          authToken: config.authToken || (env.LOGS_INTERCEPTOR_AUTH_TOKEN as string),
        },
        appName: config.appName || 'node-red',
        environment: config.environment || 'production',
        version: config.version || '1.0.0',
        interceptConsole: config.interceptConsole ?? false,
        debug: config.debug ?? false,
      };

      logger = init(loggerConfig);
      initialized = true;

      this.status({ fill: 'green', shape: 'dot', text: 'connected' });
      this.log('Logs interceptor initialized');
    } catch (error: any) {
      this.error(`Failed to initialize logs interceptor: ${error.message}`);
      this.status({ fill: 'red', shape: 'ring', text: 'error' });
      initialized = false;
    }

    // Handle incoming messages
    this.on('input', (msg: NodeRedMessage) => {
      if (!initialized || !logger) {
        this.warn('Logger not initialized');
        this.send(msg);
        return;
      }

      try {
        const payload = msg.payload;
        const level = (msg.level as string) || 'info';
        const message =
          typeof payload === 'string'
            ? payload
            : safeStringify(payload);

        const context: Record<string, unknown> = {
          nodeId: this.id,
          nodeName: this.name,
          topic: msg.topic,
          ...(typeof payload === 'object' && payload !== null
            ? (boundedSnapshot(payload) as Record<string, unknown>)
            : {}),
        };

        // Remove payload from context to avoid duplication
        delete context.payload;

        switch (level.toLowerCase()) {
          case 'debug':
            logger.debug(message, context);
            break;
          case 'info':
            logger.info(message, context);
            break;
          case 'warn':
            logger.warn(message, context);
            break;
          case 'error':
            logger.error(message, context);
            break;
          case 'fatal':
            logger.fatal(message, context);
            break;
          default:
            logger.info(message, context);
        }

      } catch (error: any) {
        this.error(`Error processing log: ${error.message}`);
      } finally {
        this.send(msg);
      }
    });

    // Handle node close
    this.on('close', async () => {
      if (logger && typeof logger.destroy === 'function') {
        try {
          await logger.destroy();
          this.log('Logs interceptor destroyed');
        } catch (error: any) {
          this.error(`Error destroying logger: ${error.message}`);
        }
      }
    });
  }

  // Register the node
  RED.nodes.registerType('logs-interceptor', LogsInterceptorNode);

  // Register node configuration
  RED.httpAdmin.get('/logs-interceptor/config', function (req: any, res: any) {
    res.json({
      name: 'logs-interceptor',
      label: 'Logs Interceptor',
      category: 'logging',
      defaults: {
        name: { value: '' },
        url: { value: '' },
        tenantId: { value: '' },
        appName: { value: 'node-red' },
        environment: { value: 'production' },
      },
      inputs: 1,
      outputs: 1,
      icon: 'file.png',
    });
  });
};

