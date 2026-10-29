/**
 * Infrastructure: Gzip Compressor Implementation
 * Asynchronous gzip compression
 */
import { gzip } from 'zlib';
import { promisify } from 'util';
import { ICompressor, CompressorConfig } from '../../domain/interfaces/ICompressor';

const gzipAsync = promisify(gzip);

export class GzipCompressor implements ICompressor {
  private readonly threshold: number;
  private readonly level: number;

  constructor(private readonly config: CompressorConfig = {}) {
    this.threshold = config.threshold ?? 1024; // 1KB default
    this.level = config.level ?? 6; // Balanced compression/speed
  }

  async compress(data: string | Buffer): Promise<Buffer> {
    const input = typeof data === 'string' ? Buffer.from(data) : data;

    // Don't compress if smaller than threshold
    if (input.length < this.threshold) {
      return input;
    }

    try {
      const compressed = (await gzipAsync(input, {
        level: this.level,
        chunkSize: 16 * 1024, // 16KB chunks for better performance
      })) as Buffer;

      // Only return compressed if it's actually smaller
      if (compressed.length < input.length) {
        return compressed;
      }

      // Return original if compression didn't help
      return input;
    } catch (error) {
      // If compression fails, return original data
      console.warn('[GzipCompressor] Compression failed, returning original:', error);
      return input;
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
