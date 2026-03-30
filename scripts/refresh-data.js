#!/usr/bin/env node
'use strict';

/**
 * Standalone data refresh script.
 *
 * Fetches all league data from APIs (Fantrax, FanGraphs) and generates
 * power rankings JSON files.  Designed to run headlessly via GitHub Actions
 * or locally — no web server required.
 *
 * Usage:
 *   node scripts/refresh-data.js              # full refresh
 *   node scripts/refresh-data.js --skip-api   # only regenerate rankings from existing data files
 *
 * Environment variables:
 *   FANTRAX_LEAGUE_ID  — required
 *   FANTRAX_COOKIE     — required for authenticated Fantrax endpoints
 */

// Load .env from project root
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Ensure config can load (validates FANTRAX_LEAGUE_ID)
const config = require('../server/config');
const api = require('../data/api');
const rankings = require('../server/rankings');

function ts() {
  return new Date().toISOString();
}

async function fetchAllData() {
  const errors = [];

  async function run(name, fn) {
    try {
      console.log(`[${ts()}] Fetching: ${name}`);
      await fn();
      console.log(`[${ts()}] Done: ${name}`);
    } catch (err) {
      console.error(`[${ts()}] Failed: ${name} — ${err.message}`);
      errors.push(`${name}: ${err.message}`);
    }
  }

  await run('rosters', () => api.updateRosters());
  await run('projections', async () => {
    for (const type of config.projectionTypes) {
      await api.updateProjections(type);
    }
  });
  await run('adp', () => api.updateADP());
  await run('draft', async () => {
    await api.updateDraftPicks();
    await api.updateDraftResults();
  });
  await run('playerStats', () => api.updateRealPlayerStats());

  // Real stats (requires cookie, may fail)
  await run('standings', async () => {
    try {
      await api.updateRealStats();
    } catch (err) {
      console.warn(`  Real stats skipped: ${err.message}`);
    }
  });

  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const skipApi = args.includes('--skip-api');
  const start = Date.now();

  console.log('='.repeat(55));
  console.log('  Keeper League — Data Refresh');
  console.log(`  League: ${config.leagueId}`);
  console.log(`  Mode:   ${skipApi ? 'Rankings only (skip API)' : 'Full refresh'}`);
  console.log('='.repeat(55));

  let fetchErrors = [];

  if (!skipApi) {
    fetchErrors = await fetchAllData();
  }

  // Always regenerate rankings from whatever data is on disk
  console.log(`\n[${ts()}] Generating power rankings...`);
  try {
    const result = await rankings.generateRankings();
    console.log(`[${ts()}] Rankings generated — ${Object.keys(result.systems).length} systems, date: ${result.serverDate}`);
  } catch (err) {
    console.error(`[${ts()}] Rankings generation failed: ${err.message}`);
    fetchErrors.push(`rankings: ${err.message}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);

  if (fetchErrors.length > 0) {
    console.log(`\nWarnings/Errors (${fetchErrors.length}):`);
    fetchErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }

  // Exit 0 even with partial failures so CI doesn't fail on optional endpoints
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
