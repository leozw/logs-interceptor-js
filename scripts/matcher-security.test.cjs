const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(key => process.env[key] !== undefined).map(key => [key,process.env[key]]));
function child(source) {
  const result = spawnSync(process.execPath, ['-e', source], { cwd: root, env, encoding: 'utf8', timeout: 2500 });
  assert.equal(result.signal, null, 'watchdog: synchronous matcher did not settle');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('SYNTHETIC_INLINE_CREDENTIAL_4821'));
  assert.ok(!result.stderr.includes('SYNTHETIC_INLINE_CREDENTIAL_4821'));
}
for (const site of ['message','selector','context-key','context-value','record-label','resource']) {
  test('public bounded custom matcher: ' + site, () => child(`
    const assert=require('node:assert/strict'),api=require('./dist');
    const site=${JSON.stringify(site)},value='b'+'a'.repeat(63),pattern=/(a|aa)+b/;
    pattern.test=()=>{throw new Error('unsafe caller test invoked');};Object.freeze(pattern);
    const config={appName:'security',transport:{type:'otlp',url:'http://127.0.0.1:9',compression:'none',useWorkers:false,maxRetries:0},buffer:{autoFlush:false},interceptConsole:false,filter:{sensitivePatterns:site==='selector'?undefined:[pattern],patterns:site==='selector'?[pattern]:undefined}};
    if(site==='resource')config.labels={note:value};if(site==='record-label')config.dynamicLabels={note:()=>value};
    const original=Object.freeze(site==='context-key'?{[value]:'ordinary'}:site==='context-value'?{note:value}:{marker:'same'});
    const logger=api.init(config);logger.info(site==='message'||site==='selector'?value:'ordinary',original);
    const entries=logger.buffer.flush();assert.equal(entries.length,site==='selector'?0:1);assert.deepEqual(logger.getHealth().privacyDiagnostics,[]);
    assert.equal(original.note||original.marker||original[value],site==='context-value'?value:site==='context-key'?'ordinary':'same');
    api.destroy().then(()=>process.exit(0),()=>process.exit(1));
  `));
}
test('nested repetition executes with a genuine linear backend', () => child(`
  const assert=require('node:assert/strict'),{detectSensitiveData}=require('./dist/utils');
  assert.equal(detectSensitiveData('a'.repeat(16384)+'!', [/(a+)+$/]),false);
`));
test('unsupported policy throws a value-free startup error before initialization', () => child(`
  const assert=require('node:assert/strict'),api=require('./dist');
  assert.throws(()=>api.init({appName:'rejected',transport:{type:'otlp',url:'http://127.0.0.1:9'},filter:{sensitivePatterns:[/(?=SYNTHETIC_INLINE_CREDENTIAL_4821)x/]}}),error=>error.message.includes('ELVEN_MATCHER_UNSUPPORTED_PATTERN')&&!error.message.includes('SYNTHETIC_INLINE_CREDENTIAL_4821'));
`));
test('default privacy is certified-native, Unicode correct and does not load RE2', () => child(`
  const assert=require('node:assert/strict'),api=require('./dist');const logger=api.init({appName:'default',transport:{type:'otlp',url:'http://127.0.0.1:9',compression:'none'},buffer:{autoFlush:false},interceptConsole:false});
  for(const message of ['Bearer\\u00a0synthetic','Bearer\\ufeffsynthetic','person@example.test'])logger.info(message);
  assert.ok(logger.buffer.flush().every(entry=>entry.message==='[REDACTED]'));
  assert.equal(require.cache[require.resolve('re2js')],undefined);assert.equal(require.cache[require.resolve('@eslint-community/regexpp')],undefined);
  api.destroy().then(()=>process.exit(0),()=>process.exit(1));
`));
test('explicit privacy disable preserves raw caller intent, not a failure fallback', () => child(`
  const assert=require('node:assert/strict'),api=require('./dist');const logger=api.init({appName:'off',transport:{type:'otlp',url:'http://127.0.0.1:9'},buffer:{autoFlush:false},filter:{sanitize:false,sensitivePatterns:[/(?=private)/]},interceptConsole:false});
  logger.info('private');assert.equal(logger.buffer.flush()[0].message,'private');api.destroy().then(()=>process.exit(0),()=>process.exit(1));
`));
