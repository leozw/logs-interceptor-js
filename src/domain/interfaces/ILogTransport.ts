import { LogEntry } from '../entities/LogEntry';

/**
 * Interface for log transport implementations
 * Follows Interface Segregation Principle
 */
export interface ILogTransport {
  /**
   * Send logs to the transport destination
   */
  send(entries: LogEntry[]): Promise<void>;

  /**
   * Check if transport is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get transport health status
   */
  getHealth(): TransportHealth;

  /**
   * Destroy the transport and cleanup resources
   */
  destroy(): Promise<void>;

  /**
   * Get transport metrics
   */
  getMetrics(): TransportMetrics | undefined;
}

export interface TransportHealth {
  readonly healthy: boolean;
  readonly lastSuccessfulSend?: number;
  readonly consecutiveFailures: number;
  readonly errorMessage?: string;
}

export interface TransportMetrics {
  totalSends: number;
  successfulSends: number;
  failedSends: number;
  avgLatency: number;
  avgCompressionTime?: number;
  avgCompressionRatio?: number;
  totalBytesSent?: number;
  totalBytesCompressed?: number;
}



