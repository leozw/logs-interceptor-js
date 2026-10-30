import assert from 'node:assert/strict';
import { lessThan } from '../../test-support/assertions';
import { afterEach, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { eachTest } from '../../test-support/data-provider';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { parse } from 'protobufjs';
import { destroy, init } from '../index';
import { applyLabelPolicy } from '../infrastructure/filter/LabelPolicy';

const requestType = parse(`syntax="proto3";
message Value { string stringValue=1; }
message KeyValue { string key=1; Value value=2; }
message Resource { repeated KeyValue attributes=1; }
message Log { Value body=5; repeated KeyValue attributes=6; }
message ScopeLogs { repeated Log logRecords=2; }
message ResourceLogs { Resource resource=1; repeated ScopeLogs scopeLogs=2; }
message Request { repeated ResourceLogs resourceLogs=1; }
`).root.lookupType('Request');

afterEach(async () => { await destroy(); });

test('label budget sentinels remain string-valued and snapshots do not call accessors', () => {
  let accessed = 0;
  const source = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`label_${index}`, 'x'.repeat(20000)]));
  const bounded: Record<string, string> = applyLabelPolicy(source, { sanitize: false, sensitivePatterns: [] });
  assert.strictEqual((Object.values(bounded).every(value => typeof value === 'string')), true);
  assert.strictEqual((typeof bounded._truncated), 'string');
  lessThan(Buffer.byteLength(JSON.stringify(bounded)), 20000);
  assert.strictEqual((source.label_0).length, 20000);
  const input = { _truncated: true, nested: { password: 'private' } };
  Object.defineProperty(input, 'getter', { enumerable: true, get() { accessed++; return 'private'; } });
  const normalized: Record<string, string> = applyLabelPolicy(input, { sanitize: true, sensitivePatterns: [/password/i] });
  assert.strictEqual((normalized._truncated), 'true');
  assert.strictEqual((normalized.nested), '[INVALID_LABEL_VALUE]');
  assert.strictEqual((accessed), 0);
});

eachTest(['default', 'custom', 'disabled'] as const)(
  'whole OTLP payload applies %s label privacy to Resource and records without source mutation',
  async mode => {
    const bodies: Buffer[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        bodies.push(req.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body);
        res.setHeader('content-type', 'application/x-protobuf');
        res.end();
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const labels = Object.freeze({
      password: 'synthetic-resource-password-9b2d',
      email: 'synthetic-resource-email@example.invalid',
      organization: 'synthetic-configured-value-4e72',
      plain: 'safe-static-value',
    });
    try {
      const address = server.address() as { port: number };
      const logger = init({
        appName: 'resource-policy-test', labels,
        transport: { type: 'otlp', url: `http://127.0.0.1:${address.port}`, compression: mode === 'custom' ? 'gzip' : 'none', maxRetries: 0 },
        buffer: { autoFlush: false },
        filter: mode === 'disabled' ? { sanitize: false }
          : mode === 'custom' ? { sensitivePatterns: [/password/i, /organization/i] } : {},
      });
      logger.info('resource-policy-log');
      await logger.flush();
      assert.strictEqual((bodies).length, 1);
      const body = bodies[0];
      assert.ok((body.toString()).includes('resource-policy-log'));
      const decoded = requestType.toObject(requestType.decode(body));
      assert.strictEqual((decoded.resourceLogs).length, 1);
      const resourceAttributes = decoded.resourceLogs[0].resource.attributes;
      const recordAttributes = decoded.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
      for (const [key, original] of Object.entries(labels)) {
        const redacted = mode !== 'disabled' && (key === 'password' || key === 'email' || (mode === 'custom' && key === 'organization'));
        const expected = redacted ? '[REDACTED]' : original;
        // Search the complete decompressed protobuf, not just the log body.
        assert.strictEqual((body.includes(Buffer.from(original))), !redacted);
        assert.ok(([{ key, value: { stringValue: expected } }]).every((expected: unknown) => (resourceAttributes).some((actual: unknown) => isDeepStrictEqual(actual, expected))));
        assert.ok(([{ key, value: { stringValue: expected } }]).every((expected: unknown) => (recordAttributes).some((actual: unknown) => isDeepStrictEqual(actual, expected))));
      }
      assert.strictEqual((labels.password), 'synthetic-resource-password-9b2d');
      assert.strictEqual((labels.email), 'synthetic-resource-email@example.invalid');
      assert.strictEqual((Object.isFrozen(labels)), true);
      assert.deepStrictEqual((Object.keys(labels)), ['password', 'email', 'organization', 'plain']);
    } finally {
      await destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  },
);
