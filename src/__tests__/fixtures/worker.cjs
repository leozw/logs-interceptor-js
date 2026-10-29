const { parentPort } = require('node:worker_threads');
parentPort.on('message', message => {
  if (message.data === 'hang') return;
  if (message.data === 'exit') process.exit(0);
  if (message.data === 'crash') throw new Error('fixture crash');
  parentPort.postMessage({ id: message.id, result: { data: message.data, execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS } });
});
