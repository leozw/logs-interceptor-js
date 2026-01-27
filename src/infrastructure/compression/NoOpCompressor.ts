/**
 * Infrastructure: No-Op Compressor Implementation
 * Returns data without compression (for testing or when compression is disabled)
 */
import { ICompressor } from '../../domain/interfaces/ICompressor';

export class NoOpCompressor implements ICompressor {
  async compress(data: string | Buffer): Promise<Buffer> {
    return typeof data === 'string' ? Buffer.from(data) : data;
  }

  getContentEncoding(): string {
    return '';
  }

  getName(): string {
    return 'none';
  }
}
