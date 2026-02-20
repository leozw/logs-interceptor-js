/**
 * Worker Thread: Log Processor
 * Handles log formatting and compression in background threads
 */
import * as protobuf from 'protobufjs';
import * as snappy from 'snappy';
import { promisify } from 'util';
import { parentPort } from 'worker_threads';
import { brotliCompress, constants, gzip } from 'zlib';
import { LogEntry } from '../../domain/entities/LogEntry';
import { LOKI_PROTO } from '../transport/proto/loki-proto';

const gzipAsync = promisify(gzip);
const brotliCompressAsync = promisify(brotliCompress);

let pbRoot: protobuf.Root | null = null;
let pbPushRequest: protobuf.Type | null = null;

function initProtobuf() {
  if (!pbPushRequest) {
    const parsed = protobuf.parse(LOKI_PROTO);
    pbRoot = parsed.root;
    pbPushRequest = pbRoot.lookupType('logproto.PushRequest');
  }
}

interface WorkerMessage {
  type: 'format' | 'compress' | 'process' | 'encodeProtobufAndCompress';
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

      case 'encodeProtobufAndCompress': {
        const payloadInput = message.data as LogEntry[];
        result = await encodeLokiProtobuf(payloadInput);
        originalSize = payloadInput.length; // rough estimate of entries
        compressedSize = result.length;
        break;
      }

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

async function encodeLokiProtobuf(entries: LogEntry[]): Promise<Buffer> {
  initProtobuf();
  if (!pbPushRequest) throw new Error('Protobuf not initialized in worker');

  const streams = groupEntries(entries);
  const payload = {
    streams: streams.map(({ labels, entries }) => ({
      labels: formatLabels(labels),
      entries: entries.map(entry => ({
        timestamp: getProtobufTimestamp(entry.timestamp),
        line: formatLogLine(entry),
      })),
    })),
  };

  const errMsg = pbPushRequest.verify(payload);
  if (errMsg) throw new Error(`Protobuf verification failed in worker: ${errMsg}`);

  const buffer = pbPushRequest.encode(payload).finish();
  return await snappy.compress(Buffer.from(buffer));
}

function groupEntries(entries: LogEntry[]): { labels: Record<string, string>; entries: LogEntry[] }[] {
  const groups = new Map<string, { labels: Record<string, string>; entries: LogEntry[] }>();
  for (const entry of entries) {
    const labels = entry.labels || {};
    const keys = Object.keys(labels).sort();
    const id = keys.map(k => `${k}="${labels[k]}"`).join(',');

    if (!groups.has(id)) {
      groups.set(id, { labels, entries: [] });
    }
    groups.get(id)!.entries.push(entry);
  }
  return Array.from(groups.values());
}

function formatLabels(labels: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return '{}';
  const pairs = Object.keys(labels)
    .sort()
    .map(k => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${pairs.join(',')}}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getProtobufTimestamp(isoString: string): { seconds: number; nanos: number } {
  const date = new Date(isoString);
  const ms = date.getTime();
  return {
    seconds: Math.floor(ms / 1000),
    nanos: (ms % 1000) * 1_000_000,
  };
}

function formatLogLine(entry: LogEntry): string {
  const { id, timestamp, labels, ...rest } = entry;
  return JSON.stringify(rest);
}
