import { addAbortSignal, type Transform } from 'node:stream';

export function compressStream(input: Buffer, stream: Transform, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let error: Error | undefined;
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.once('error', (cause: Error) => { error = cause; });
    // Do not reject early and abandon the native stream's pending work.
    stream.once('close', () => {
      if (signal?.aborted) reject(signal.reason);
      else if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    });
    if (signal) addAbortSignal(signal, stream);
    stream.end(input);
  });
}
