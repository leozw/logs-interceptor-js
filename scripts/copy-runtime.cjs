const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, '../dist/infrastructure/privacy/matcher-core.cjs');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(path.join(__dirname, '../src/infrastructure/privacy/matcher-core.cjs'), target);
