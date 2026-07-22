#!/usr/bin/env node

import http from 'node:http';

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3001,
  path: '/api/health',
  method: 'GET',
  timeout: 5000,
};

const req = http.request(options, res => {
  if (res.statusCode === 200) {
    let data = '';

    res.on('data', chunk => {
      data += chunk;
    });

    res.on('end', () => {
      try {
        const health = JSON.parse(data);

        // The /api/health contract is { status: 'ok', timestamp }. If a
        // database field is ever added, honor it too; otherwise `status: ok`
        // (i.e. the server is up and serving) is the health signal.
        const dbOk = health.database ? health.database.status === 'connected' : true;
        if (health.status === 'ok' && dbOk) {
          console.log('✅ Health check passed');
          process.exit(0);
        } else {
          console.error('❌ Health check failed: Service unhealthy');
          console.error(JSON.stringify(health, null, 2));
          process.exit(1);
        }
      } catch (error) {
        console.error('❌ Health check failed: Invalid response');
        console.error(error.message);
        process.exit(1);
      }
    });
  } else {
    console.error(`❌ Health check failed: HTTP ${res.statusCode}`);
    process.exit(1);
  }
});

req.on('error', error => {
  console.error('❌ Health check failed: Connection error');
  console.error(error.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('❌ Health check failed: Timeout');
  req.destroy();
  process.exit(1);
});

req.end();
