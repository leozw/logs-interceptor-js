/**
 * Infrastructure: Brotli Compressor Implementation
 * Modern compression algorithm with 15-20% better compression than gzip
 */
import { createBrotliCompress, constants } from 'zlib';
import { CompressorConfig, ICompressor } from '../../domain/interfaces/ICompressor';
import { internalWarn } from '../../utils';

import { compressStream } from './compressStream';

export class BrotliCompressor implements ICompressor {
  private readonly level: number;

  constructor(private readonly config: CompressorConfig = {}) {
    // Brotli levels: 0-11, default 4 (good balance)
    // Brotli levels: 0-11, default 4 (good balance)
    this.level = config.level ?? 4;
  }

  async compress(data: string | Buffer, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    const input = typeof data === 'string' ? Buffer.from(data) : data;

    try {
      return await compressStream(input, createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: this.level,
          [constants.BROTLI_PARAM_SIZE_HINT]: input.length,
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT, // Optimized for text/JSON
          [constants.BROTLI_PARAM_LGWIN]: 22, // Window size for better compression
        },
      }), signal);
    } catch (error) {
      signal?.throwIfAborted();
      internalWarn('Brotli compression failed', error);
      throw error;
    }
  }

  getContentEncoding(): string {
    return 'br';
  }

  getName(): string {
    return 'brotli';
  }

  getCompressionRatio(originalSize: number, compressedSize: number): number {
    if (originalSize === 0) return 0;
    return Math.round((1 - compressedSize / originalSize) * 100);
  }
}
