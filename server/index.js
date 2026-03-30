#!/usr/bin/env node
'use strict';

// Load .env and validate config before anything else
const config = require('./config');
const scheduler = require('./scheduler');
const serve = require('./serve');

async function main() {
  console.log('='.repeat(55));
  console.log('  Keeper League Backend');
  console.log(`  League: ${config.leagueId}`);
  console.log(`  Port:   ${config.port}`);
  console.log('='.repeat(55));

  // 1. Register cron jobs
  scheduler.startAll();

  // 2. Start HTTP server (serves frontend + data files + status API)
  serve.start();

  // 3. Immediately fetch all data on startup
  await scheduler.runAll();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  process.exit(0);
});
