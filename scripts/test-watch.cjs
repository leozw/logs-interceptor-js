const path = require('node:path');
const { spawn } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let child, pending = false, stopping = false;
function run() {
  if (child || stopping || !pending) return;
  pending = false;
  child = spawn(process.execPath, [path.join(__dirname, 'test.cjs')], { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32' });
  child.once('error', error => console.error(error));
  child.once('close', () => { child = undefined; run(); });
}
const host = ts.createWatchCompilerHost(path.join(root, 'tsconfig.tests.json'), { noEmit: true }, ts.sys);
const afterProgramCreate = host.afterProgramCreate;
host.afterProgramCreate = builder => {
  afterProgramCreate(builder);
  if (ts.getPreEmitDiagnostics(builder.getProgram()).some(item => item.category === ts.DiagnosticCategory.Error)) return;
  pending = true; run();
};
const watch = ts.createWatchProgram(host);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stopping = true; watch.close();
  if (!child) return;
  const owned = child, terminate = value => {
    try { if (process.platform !== 'win32') process.kill(-owned.pid, value); else owned.kill(value); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  terminate('SIGTERM');
  const deadline = setTimeout(() => terminate('SIGKILL'), 1000);
  owned.once('close', () => clearTimeout(deadline));
});
