const { init, logger } = require('./dist');

async function run() {
  console.log('--- Debugging Connection ---');

  init({
    appName: 'gateway-prd',
    transport: {
      url: 'https://loki.elvenobservability.com/loki/api/v1/push',
      tenantId: 'Econodata',
      authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJlbHZlbi1sZ3RtLWp3dCIsIm9yZ0lkIjoiZWx2ZW4tbGd0bSIsImlhdCI6MTc2OTY5NDg4MH0.XBGK8ToAtpAUC_QmDrW2bFb-CXJYyQJqCHfUTjeElAA',
      timeout: 10000,
      compression: 'snappy',
      useWorkers: true,
      maxWorkers: 1,
    },
    buffer: {
      maxSize: 51,
      flushInterval: 2000,
    }
  });

  for (let i = 0; i < 52; i++) {
    logger.info(`Test log from debug script ${i} - Snappy + WorkerPool`);
  }

  await new Promise(r => setTimeout(r, 4000));

  const health = logger.getHealth();
  console.log('\n--- Logger Health ---');
  console.log(JSON.stringify(health, null, 2));

  await logger.destroy();
}

run().catch(console.error);
