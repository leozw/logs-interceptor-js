/**
 * Infrastructure: Compressor Factory
 * Creates appropriate compressor based on configuration
 */
import { ICompressor } from '../../domain/interfaces/ICompressor';
import { GzipCompressor } from './GzipCompressor';
import { BrotliCompressor } from './BrotliCompressor';
import { NoOpCompressor } from './NoOpCompressor';
import { CompressorConfig } from '../../domain/interfaces/ICompressor';

export type CompressionType = 'none' | 'gzip' | 'brotli' | boolean;

export class CompressorFactory {
  static create(
    type: CompressionType,
    config?: CompressorConfig
  ): ICompressor {
    // Handle boolean for backward compatibility
    if (type === false || type === 'none') {
      return new NoOpCompressor();
    }

    // Default to gzip if true (backward compatibility)
    if (type === true) {
      return new GzipCompressor(config);
    }

    // At this point, type can only be 'gzip' | 'brotli'
    if (type === 'gzip') {
      return new GzipCompressor(config);
    }
    
    if (type === 'brotli') {
      return new BrotliCompressor(config);
    }

    // Fallback to gzip for unknown types
    return new GzipCompressor(config);
  }

  /**
   * Auto-detect best compressor based on Accept-Encoding header
   */
  static createFromAcceptEncoding(
    acceptEncoding: string | undefined,
    config?: CompressorConfig
  ): ICompressor {
    if (!acceptEncoding) {
      return new GzipCompressor(config);
    }

    // Check for Brotli support first (better compression)
    if (acceptEncoding.includes('br')) {
      return new BrotliCompressor(config);
    }

    // Fallback to gzip
    if (acceptEncoding.includes('gzip')) {
      return new GzipCompressor(config);
    }

    // Default to gzip
    return new GzipCompressor(config);
  }
}
