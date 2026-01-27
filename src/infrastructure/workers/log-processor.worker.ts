/**
 * Worker Thread: Log Processor
 * Handles log formatting and compression in background threads
 */
import { parentPort, workerData } from 'worker_threads';
import { LogEntry } from '../../domain/entities/LogEntry';
import { gzip, brotliCompress, constants } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const brotliCompressAsync = promisify(brotliCompress);

interface WorkerMessage {
  type: 'format' | 'compress' | 'process';
  data: any;
  id: string;
  options?: {
    compressionType?: 'gzip' | 'brotli';
    compressionLevel?: number;
  };
}

interface WorkerResponse {
  id: string;
  result?: any;
  error?: string;
  metrics?: {
    duration: number;
    originalSize?: number;
    compressedSize?: number;
  };
}

parentPort?.on('message', async (message: WorkerMessage) => {
  const startTime = Date.now();
  
  try {
    let result: any;
    let originalSize: number | undefined;
    let compressedSize: number | undefined;

    switch (message.type) {
      case 'format':
        result = formatForLoki(message.data);
        break;

      case 'compress':
        originalSize = typeof message.data === 'string' 
          ? Buffer.byteLength(message.data, 'utf8')
          : message.data.length;
        
        result = await compressData(
          message.data,
          message.options?.compressionType || 'gzip',
          message.options?.compressionLevel
        );
        
        compressedSize = result.length;
        break;

      case 'process':
        result = processLogs(message.data);
        break;

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }

    const duration = Date.now() - startTime;

    const response: WorkerResponse = {
      id: message.id,
      result,
      metrics: {
        duration,
        originalSize,
        compressedSize,
      },
    };

    parentPort?.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: message.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    parentPort?.postMessage(response);
  }
});

function formatForLoki(entries: LogEntry[]): any {
  const streamMap = new Map<string, [string, string][]>();

  entries.forEach((entry) => {
    const streamKey = JSON.stringify(entry.labels ?? {});
    const timestamp = String(Date.parse(entry.timestamp) * 1_000_000); // nanoseconds

    const logData: Record<string, any> = {
      id: entry.id,
      level: entry.level,
      message: entry.message,
    };

    if (entry.context) {
      logData.context = entry.context;
    }

    if (entry.traceId && entry.traceId !== 'undefined') {
      logData.traceId = entry.traceId;
    }
    if (entry.spanId && entry.spanId !== 'undefined') {
      logData.spanId = entry.spanId;
    }
    if (entry.requestId && entry.requestId !== 'undefined') {
      logData.requestId = entry.requestId;
    }
    if (entry.metadata) {
      logData.metadata = entry.metadata;
    }

    const logLine = JSON.stringify(logData);

    if (!streamMap.has(streamKey)) {
      streamMap.set(streamKey, []);
    }
    streamMap.get(streamKey)!.push([timestamp, logLine]);
  });

  return {
    streams: Array.from(streamMap.entries()).map(([streamKey, values]) => ({
      stream: JSON.parse(streamKey),
      values: values.sort((a, b) => a[0].localeCompare(b[0])),
    })),
  };
}

async function compressData(
  data: string | Buffer,
  type: 'gzip' | 'brotli',
  level?: number
): Promise<Buffer> {
  const input = typeof data === 'string' ? Buffer.from(data) : data;

  if (type === 'brotli') {
    return (await brotliCompressAsync(input, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: level ?? 4,
        [constants.BROTLI_PARAM_SIZE_HINT]: input.length,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      },
    })) as Buffer;
  }

  // Default to gzip
  return (await gzipAsync(input, {
    level: level ?? 6,
    chunkSize: 16 * 1024,
  })) as Buffer;
}

function processLogs(entries: LogEntry[]): LogEntry[] {
  // Additional processing if needed
  return entries;
}
