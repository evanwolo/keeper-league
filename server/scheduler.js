const cron = require('node-cron');
const config = require('./config');
const api = require('../data/api');

// ── Job status tracking ─────────────────────────────────────────────────────

const status = {};

function ts() {
  return new Date().toISOString();
}

const JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minute hard timeout per job

async function runJob(name, fn) {
  const entry = status[name] || (status[name] = {
    lastRun: null, lastError: null, running: false, runCount: 0,
  });

  if (entry.running) {
    // Safety valve: if a job has been "running" for over 10 minutes, assume it crashed
    if (entry.runStart && Date.now() - entry.runStart > JOB_TIMEOUT_MS) {
      console.warn(`[${ts()}] Force-resetting stuck job: ${name} (started ${entry.runStart})`);
      entry.running = false;
    } else {
      console.log(`[${ts()}] Skipping ${name} — already running`);
      return;
    }
  }

  entry.running = true;
  entry.runStart = Date.now();
  console.log(`[${ts()}] Starting: ${name}`);

  try {
    await fn();
    entry.lastRun = ts();
    entry.lastError = null;
    entry.runCount++;
    console.log(`[${ts()}] Completed: ${name}`);
  } catch (err) {
    entry.lastError = { time: ts(), message: err.message };
    console.error(`[${ts()}] Failed: ${name} — ${err.message}`);
  } finally {
    entry.running = false;
    entry.runStart = null;
  }
}

// ── Job definitions ─────────────────────────────────────────────────────────

const jobs = {
  rosters: () => runJob('rosters', () => api.updateRosters()),

  standings: () => runJob('standings', async () => {
    // updateRealStats can fail without a cookie; swallow gracefully
    try {
      await api.updateRealStats();
    } catch (err) {
      console.warn(`  Real stats skipped: ${err.message}`);
      if (!config.fantraxCookie) {
        console.warn('  Hint: set FANTRAX_COOKIE for authenticated stats endpoints.');
      }
    }
  }),

  projections: () => runJob('projections', async () => {
    for (const type of config.projectionTypes) {
      await api.updateProjections(type);
    }
  }),

  draft: () => runJob('draft', async () => {
    await api.updateDraftPicks();
    await api.updateDraftResults();
  }),

  adp: () => runJob('adp', () => api.updateADP()),

  playerStats: () => runJob('playerStats', () => api.updateRealPlayerStats()),
};

// ── Scheduler control ───────────────────────────────────────────────────────

function startAll() {
  console.log(`[${ts()}] Scheduling cron jobs:`);

  for (const [name, schedule] of Object.entries(config.schedules)) {
    if (!cron.validate(schedule)) {
      console.error(`  Invalid cron for ${name}: "${schedule}" — skipping`);
      continue;
    }
    if (!jobs[name]) {
      console.warn(`  No job registered for schedule key: ${name} — skipping`);
      continue;
    }
    cron.schedule(schedule, jobs[name]);
    console.log(`  ${name.padEnd(13)} ${schedule}`);
  }
}

async function runAll() {
  console.log(`\n[${ts()}] Running initial data fetch...`);
  await jobs.rosters();
  await jobs.standings();
  await jobs.projections();
  await jobs.draft();
  await jobs.adp();
  await jobs.playerStats();
  console.log(`[${ts()}] Initial fetch complete.\n`);
}

function getStatus() {
  return { ...status };
}

module.exports = { startAll, runAll, jobs, getStatus };
