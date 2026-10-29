export async function consumeResponse(
  body: AsyncIterable<Uint8Array> & { destroy(error?: Error): unknown },
): Promise<void> {
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > 65_536) {
      body.destroy();
      throw new Error('Telemetry response exceeds 65536 byte limit');
    }
  }
}
