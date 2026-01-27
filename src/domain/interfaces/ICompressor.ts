/**
 * Domain Interface: ICompressor
 * Defines contract for compression implementations
 */
export interface ICompressor {
  /**
   * Compress data asynchronously
   * @param data Data to compress (string or Buffer)
   * @returns Compressed data as Buffer
   */
  compress(data: string | Buffer): Promise<Buffer>;

  /**
   * Get Content-Encoding header value
   */
  getContentEncoding(): string;

  /**
   * Get compressor name
   */
  getName(): string;

  /**
   * Get compression ratio (if available)
   */
  getCompressionRatio?(originalSize: number, compressedSize: number): number;
}

export interface CompressorConfig {
  /**
   * Compression level (0-9 for gzip, 0-11 for brotli)
   */
  readonly level?: number;

  /**
   * Minimum size threshold in bytes - only compress if data is larger
   * Default: 1024 (1KB)
   */
  readonly threshold?: number;

  /**
   * Enable adaptive compression based on data characteristics
   */
  readonly adaptive?: boolean;
}
