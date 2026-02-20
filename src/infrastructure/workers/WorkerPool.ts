/**
 * Infrastructure: Worker Pool Manager
 * Manages pool of worker threads for background processing
 */
import { join } from 'path';
import { Worker } from 'worker_threads';

interface Task<T = any> {
  id: string;
  type: 'format' | 'compress' | 'process' | 'encodeProtobufAndCompress';
  data: any;
  options?: any;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

export interface WorkerPoolConfig {
  readonly maxWorkers?: number;
  readonly taskTimeout?: number; // milliseconds
  readonly workerScript?: string;
}

export interface WorkerMetrics {
  readonly activeWorkers: number;
  readonly queueLength: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private queue: Task[] = [];
  private readonly maxWorkers: number;
  private readonly taskTimeout: number;
  private readonly workerScript: string;
  private totalTasks = 0;
  private completedTasks = 0;
  private failedTasks = 0;
  private destroyed = false;

  constructor(config: WorkerPoolConfig = {}) {
    this.maxWorkers = config.maxWorkers ?? Math.max(2, Math.floor(require('os').cpus().length / 2));
    this.taskTimeout = config.taskTimeout ?? 30000; // 30s default
    const extension = __filename.endsWith('.ts') ? 'ts' : 'js';
    this.workerScript = config.workerScript || join(__dirname, `log-processor.worker.${extension}`);
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.maxWorkers; i++) {
      this.createWorker();
    }
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerScript, {
      // Worker options
    });

    // Worker messages are handled in processTask via messageHandler

    worker.on('error', (error) => {
      console.error('[WorkerPool] Worker error:', error);
      this.replaceWorker(worker);
    });

    worker.on('exit', (code) => {
      if (this.destroyed) return;
      if (code !== 0) {
        console.warn(`[WorkerPool] Worker exited with code ${code}`);
        this.replaceWorker(worker);
      }
    });

    this.workers.push(worker);
    this.availableWorkers.push(worker);

    return worker;
  }

  private replaceWorker(worker: Worker): void {
    const index = this.workers.indexOf(worker);
    if (index > -1) {
      this.workers.splice(index, 1);
      const availableIndex = this.availableWorkers.indexOf(worker);
      if (availableIndex > -1) {
        this.availableWorkers.splice(availableIndex, 1);
      }
      try {
        worker.terminate();
      } catch {
        // Ignore termination errors
      }
      this.createWorker();
    }
  }

  async execute<T = any>(
    type: 'format' | 'compress' | 'process' | 'encodeProtobufAndCompress',
    data: any,
    options?: any
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: Task<T> = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        data,
        options,
        resolve,
        reject,
      };

      this.totalTasks++;

      if (this.availableWorkers.length > 0) {
        this.processTask(task);
      } else {
        this.queue.push(task);
      }
    });
  }

  private processTask(task: Task): void {
    const worker = this.availableWorkers.pop()!;

    // Set timeout
    task.timeout = setTimeout(() => {
      worker.removeAllListeners('message');
      this.replaceWorker(worker);
      this.failedTasks++;
      task.reject(new Error(`Worker task timeout after ${this.taskTimeout}ms`));
    }, this.taskTimeout);

    const messageHandler = (response: any) => {
      if (response.id === task.id) {
        clearTimeout(task.timeout);
        worker.removeAllListeners('message');
        this.availableWorkers.push(worker);

        if (response.error) {
          this.failedTasks++;
          task.reject(new Error(response.error));
        } else {
          this.completedTasks++;
          task.resolve(response.result);
        }

        // Process next task from queue
        if (this.queue.length > 0) {
          const nextTask = this.queue.shift()!;
          this.processTask(nextTask);
        }
      }
    };

    worker.on('message', messageHandler);

    worker.postMessage({
      type: task.type,
      data: task.data,
      id: task.id,
      options: task.options,
    });
  }

  getMetrics(): WorkerMetrics {
    return {
      activeWorkers: this.workers.length - this.availableWorkers.length,
      queueLength: this.queue.length,
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
    };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    // Clear queue
    this.queue.forEach(task => {
      if (task.timeout) clearTimeout(task.timeout);
      task.reject(new Error('Worker pool destroyed'));
    });
    this.queue = [];

    // Terminate all workers
    await Promise.all(
      this.workers.map(worker => {
        try {
          return worker.terminate();
        } catch {
          return Promise.resolve();
        }
      })
    );

    this.workers = [];
    this.availableWorkers = [];
  }
}
