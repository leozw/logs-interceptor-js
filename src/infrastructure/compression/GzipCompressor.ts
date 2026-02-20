/**
 * Infrastructure: Gzip Compressor Implementation
 * Asynchronous gzip compression
 */
import { promisify } from 'util';
import { gzip } from 'zlib';
import { CompressorConfig, ICompressor } from '../../domain/interfaces/ICompressor';

const gzipAsync = promisify(gzip);

export class GzipCompressor implements ICompressor {
  private readonly level: number;

  constructor(private readonly config: CompressorConfig = {}) {
    this.level = config.level ?? 6; // Balanced compression/speed
  }

  async compress(data: string | Buffer): Promise<Buffer> {
    const input = typeof data === 'string' ? Buffer.from(data) : data;

    try {
      return (await gzipAsync(input, {
        level: this.level,
        chunkSize: 16 * 1024,
      })) as Buffer;
    } catch (error) {
      console.warn('[GzipCompressor] Compression failed:', error);
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
