'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const HISTORY_FILE = path.join(config.dataDir, 'power_rankings_history.json');

// ── Read / Write ─────────────────────────────────────────────────────────────

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return { entries: [] };
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function writeHistory(history) {
  const tmp = HISTORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(history, null, 2));
  fs.renameSync(tmp, HISTORY_FILE);
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function toDateKey(dateOrStr) {
  // Use local calendar date (not UTC) so the snapshot matches the user's day
  if (typeof dateOrStr === 'string') return dateOrStr.slice(0, 10);
  const d = dateOrStr;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, n) {
  // Parse as local noon to avoid DST edge cases
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

function daysBetween(startStr, endStr) {
  const a = new Date(startStr + 'T12:00:00');
  const b = new Date(endStr + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

// ── Snapshot shape ────────────────────────────────────────────────────────────

function buildEntry(rankings, dateKey) {
  // Strip heavy per-team stats from history to keep file small;
  // store only what's needed to show ranking, points, and per-cat ranks.
  const slim = (teamList) =>
    teamList
      ? teamList.map(t => ({
          rank:        t.rank,
          teamId:      t.teamId,
          teamName:    t.teamName,
          totalPoints: t.totalPoints,
        }))
      : [];

  const systemSlim = {};
  for (const [sysId, sys] of Object.entries(rankings.systems || {})) {
    systemSlim[sysId] = { name: sys.name, rankings: slim(sys.rankings) };
  }

  return {
    date:               dateKey,
    generatedAt:        rankings.generatedAt,
    isRetroactive:      false,
    realStatsAvailable: rankings.realStatsAvailable,
    realStatsWeight:    rankings.realStatsWeight,
    systems:            systemSlim,
    consensus:          {
      rankings:   slim(rankings.consensus && rankings.consensus.rankings),
      systemsUsed: rankings.consensus && rankings.consensus.systemsUsed,
    },
  };
}

// ── Append today's entry ──────────────────────────────────────────────────────

function appendEntry(rankings) {
  const today = toDateKey(new Date());
  const history = readHistory();

  // Purge any entries incorrectly dated in the future (e.g. from a prior UTC timezone bug)
  const before = history.entries.length;
  history.entries = history.entries.filter(e => e.date <= today);
  if (history.entries.length < before) {
    console.log(`  History: removed ${before - history.entries.length} future-dated entries`);
  }

  // Replace if an entry already exists for today
  const idx = history.entries.findIndex(e => e.date === today);
  const entry = buildEntry(rankings, today);

  if (idx >= 0) {
    history.entries[idx] = entry;
  } else {
    history.entries.push(entry);
  }

  // Keep sorted ascending by date
  history.entries.sort((a, b) => a.date.localeCompare(b.date));
  writeHistory(history);
  console.log(`  History: logged entry for ${today} (${history.entries.length} total)`);
}

// ── Retroactive backfill ──────────────────────────────────────────────────────
// Fills in missing dates from startDate (inclusive) up to yesterday (inclusive)
// using the current rankings data as the projection-only baseline.
// Entries are marked isRetroactive: true so the UI can note this.

function backfill(rankings, startDate) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    console.warn(`  History: backfill called with invalid startDate: ${JSON.stringify(startDate)} — skipping`);
    return;
  }

  const today = toDateKey(new Date());
  const yesterday = addDays(today, -1);

  if (daysBetween(startDate, yesterday) < 0) {
    console.log('  History: no retroactive dates to fill');
    return;
  }

  const history = readHistory();
  const existingDates = new Set(history.entries.map(e => e.date));

  let filled = 0;
  let cursor = startDate;

  while (cursor <= yesterday) {
    if (!existingDates.has(cursor)) {
      const entry = buildEntry(rankings, cursor);
      entry.isRetroactive = true;
      entry.generatedAt   = cursor + 'T23:00:00.000Z'; // synthetic timestamp
      history.entries.push(entry);
      filled++;
    }
    cursor = addDays(cursor, 1);
  }

  if (filled > 0) {
    history.entries.sort((a, b) => a.date.localeCompare(b.date));
    writeHistory(history);
    console.log(`  History: backfilled ${filled} retroactive entries (${startDate} → ${yesterday})`);
  } else {
    console.log('  History: all retroactive entries already present');
  }
}

module.exports = { appendEntry, backfill, readHistory, toDateKey };
