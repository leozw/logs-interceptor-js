import { join } from 'path';
import { Worker } from 'worker_threads';

interface Task<T = any> {
  id: number;
  type: 'format' | 'compress' | 'process';
  data: any;
  options?: any;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}
export interface WorkerPoolConfig {
  readonly maxWorkers?: number;
  readonly maxQueueSize?: number;
  readonly taskTimeout?: number;
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
  private workers = new Set<Worker>();
  private availableWorkers: Worker[] = [];
  private queue: Task[] = [];
  private active = new Map<
    Worker,
    { task: Task; timer: NodeJS.Timeout; handler: (message: any) => void }
  >();
  private readonly maxWorkers: number;
  private readonly maxQueueSize: number;
  private readonly taskTimeout: number;
  private readonly workerScript: string;
  private totalTasks = 0;
  private completedTasks = 0;
  private failedTasks = 0;
  private destroyed = false;
  private destroyPromise?: Promise<void>;

  constructor(config: WorkerPoolConfig = {}) {
    this.maxWorkers = bounded(config.maxWorkers, 2, 16);
    this.maxQueueSize = bounded(config.maxQueueSize, this.maxWorkers * 4, 64);
    this.taskTimeout = bounded(config.taskTimeout, 30_000, 60_000);
    this.workerScript =
      config.workerScript ||
      join(
        __dirname,
        `log-processor.worker.${__filename.endsWith('.ts') ? 'ts' : 'js'}`,
      );
    for (let i = 0; i < this.maxWorkers; i++) this.createWorker();
  }

  private createWorker(): void {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const worker = new Worker(this.workerScript, { execArgv: [], env });
    this.workers.add(worker);
    this.availableWorkers.push(worker);
    worker.on('error', (error) => this.removeWorker(worker, error));
    worker.on('exit', (code) =>
      this.removeWorker(worker, new Error(`Worker exited with code ${code}`)),
    );
    worker.unref();
  }

  private settle(worker: Worker, error?: Error, result?: any): void {
    const active = this.active.get(worker);
    if (!active) return;
    this.active.delete(worker);
    clearTimeout(active.timer);
    worker.off('message', active.handler);
    worker.unref();
    if (error) {
      this.failedTasks++;
      active.task.reject(error);
    } else {
      this.completedTasks++;
      active.task.resolve(result);
    }
  }

  private removeWorker(worker: Worker, error: Error): void {
    if (!this.workers.delete(worker)) return;
    this.availableWorkers = this.availableWorkers.filter(
      (item) => item !== worker,
    );
    this.settle(worker, error);
    void worker.terminate().catch(() => {});
    // Only replenish for queued work. Broken idle workers must not respawn forever.
    if (!this.destroyed && this.queue.length) {
      this.createWorker();
      this.drainQueue();
    }
  }

  async execute<T = any>(
    type: Task['type'],
    data: any,
    options?: any,
  ): Promise<T> {
    if (this.destroyed) throw new Error('Worker pool destroyed');
    if (!this.workers.size) this.createWorker();
    if (
      !this.availableWorkers.length &&
      this.queue.length >= this.maxQueueSize
    ) {
      this.failedTasks++;
      throw new Error(`Worker queue limit reached (${this.maxQueueSize})`);
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: ++this.totalTasks,
        type,
        data,
        options,
        resolve,
        reject,
      });
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (
      !this.destroyed &&
      this.availableWorkers.length &&
      this.queue.length
    ) {
      const worker = this.availableWorkers.pop()!;
      const task = this.queue.shift()!;
      const handler = (response: any) => {
        if (response.id !== task.id) return;
        this.settle(
          worker,
          response.error ? new Error(response.error) : undefined,
          response.result,
        );
        this.availableWorkers.push(worker);
        this.drainQueue();
      };
      const timer = setTimeout(
        () =>
          this.removeWorker(
            worker,
            new Error(`Worker task timeout after ${this.taskTimeout}ms`),
          ),
        this.taskTimeout,
      );
      this.active.set(worker, { task, timer, handler });
      worker.ref();
      worker.on('message', handler);
      try {
        worker.postMessage({
          type: task.type,
          data: task.data,
          id: task.id,
          options: task.options,
        });
      } catch (error) {
        this.settle(worker, error as Error);
        this.availableWorkers.push(worker);
      }
    }
  }

  getMetrics(): WorkerMetrics {
    return {
      activeWorkers: this.active.size,
      queueLength: this.queue.length,
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
    };
  }

  async destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyed = true;
    for (const task of this.queue) {
      this.failedTasks++;
      task.reject(new Error('Worker pool destroyed'));
    }
    this.queue = [];
    const workers = [...this.workers];
    for (const worker of workers)
      this.settle(worker, new Error('Worker pool destroyed'));
    this.workers.clear();
    this.availableWorkers = [];
    this.destroyPromise = Promise.all(
      workers.map((worker) => worker.terminate()),
    ).then(() => {});
    return this.destroyPromise;
  }
}

function bounded(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.min(max, Math.floor(value))
    : fallback;
}
