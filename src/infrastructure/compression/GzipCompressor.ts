/**
 * Infrastructure: Gzip Compressor Implementation
 * Asynchronous gzip compression
 */
import { createGzip } from 'zlib';
import { CompressorConfig, ICompressor } from '../../domain/interfaces/ICompressor';
import { internalWarn } from '../../utils';

import { compressStream } from './compressStream';

export class GzipCompressor implements ICompressor {
  private readonly level: number;

  constructor(private readonly config: CompressorConfig = {}) {
    this.level = config.level ?? 6; // Balanced compression/speed
  }

  async compress(data: string | Buffer, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    const input = typeof data === 'string' ? Buffer.from(data) : data;

    try {
      return await compressStream(input, createGzip({
        level: this.level,
        chunkSize: 16 * 1024,
      }), signal);
    } catch (error) {
      signal?.throwIfAborted();
      internalWarn('Gzip compression failed', error);
      throw error;
    }
  }

  getContentEncoding(): string {
    return 'gzip';
  }

  getName(): string {
    return 'gzip';
  }

  getCompressionRatio(originalSize: number, compressedSize: number): number {
    if (originalSize === 0) return 0;
    return Math.round((1 - compressedSize / originalSize) * 100);
  }
}
