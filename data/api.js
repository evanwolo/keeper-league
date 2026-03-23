/**
 * Fantrax API Wrapper — Fetches and updates league data files.
 *
 * Usage:
 *   node data/api.js                           # update rosters + steamer projections
 *   node data/api.js --rosters                  # update rosters + players only
 *   node data/api.js --projections [type]       # update projections (default: steamer)
 *   node data/api.js --projections steamer zips # update multiple projection types
 *
 * Projection types: steamer, zips, atc, thebat, thebatx, dc
 *
 * Environment:
 *   FANTRAX_LEAGUE_ID   — your league ID (default from config below)
 *
 * Schedule via cron / Task Scheduler:
 *   0 6 * * * node /path/to/data/api.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────

const DATA_DIR = __dirname;
const LEAGUE_ID = process.env.FANTRAX_LEAGUE_ID || 'mg9m448k';

const FANTRAX_BASE = 'https://www.fantrax.com/fxpa/req';
const FANGRAPHS_BASE = 'https://www.fangraphs.com/api/projections';

const FILES = {
  rosters: path.join(DATA_DIR, 'fantrax_rosters.json'),
  players: path.join(DATA_DIR, 'fantrax_players.json'),
  steamerBat: path.join(DATA_DIR, 'steamer_batting.json'),
  steamerPit: path.join(DATA_DIR, 'steamer_pitching.json'),
  leagueInfo: path.join(DATA_DIR, 'league_info.json'),
};

// ── HTTP helpers ────────────────────────────────────────────────────────────

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'keeper-league-updater/1.0',
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
    };

    if (options.body) {
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
    }

    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Invalid JSON from ${url}: ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

function postJSON(url, body) {
  return fetchJSON(url, { method: 'POST', body: JSON.stringify(body) });
}

function writeData(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
  console.log(`  ✓ ${path.basename(filePath)}`);
}

// ── Fantrax API ─────────────────────────────────────────────────────────────

async function fetchRosters(period) {
  const body = {
    msgs: [{
      method: 'getTeamRosters',
      data: {
        leagueId: LEAGUE_ID,
        ...(period != null && { period }),
      },
    }],
  };

  const resp = await postJSON(FANTRAX_BASE, body);
  const data = resp.responses?.[0]?.data;
  if (!data) throw new Error('Unexpected roster response structure');

  // Transform into the shape our frontend expects
  const rosters = {};
  for (const [teamId, teamData] of Object.entries(data.rosters || {})) {
    rosters[teamId] = {
      teamName: teamData.teamName,
      rosterItems: (teamData.rosterItems || []).map((item) => ({
        id: item.id,
        position: item.position,
        status: item.status,
      })),
    };
  }

  return { period: data.period || period || 1, rosters };
}

async function fetchPlayers() {
  const body = {
    msgs: [{
      method: 'getPlayerIds',
      data: { leagueId: LEAGUE_ID },
    }],
  };

  const resp = await postJSON(FANTRAX_BASE, body);
  const playerMap = resp.responses?.[0]?.data;
  if (!playerMap) throw new Error('Unexpected players response structure');

  return playerMap;
}

async function fetchLeagueInfo() {
  const body = {
    msgs: [{
      method: 'getLeagueInfo',
      data: { leagueId: LEAGUE_ID },
    }],
  };

  const resp = await postJSON(FANTRAX_BASE, body);
  return resp.responses?.[0]?.data || {};
}

// ── FanGraphs Projections ───────────────────────────────────────────────────
// Supported projection types and their FanGraphs API 'type' parameter.

const PROJECTION_TYPES = {
  steamer:  'steamer',
  zips:     'zips',
  atc:      'atc',
  thebat:   'thebat',
  thebatx:  'thebatx',
  dc:       'fangraphsdc',
};

function fetchBattingProjections(type) {
  const fgType = PROJECTION_TYPES[type];
  if (!fgType) throw new Error(`Unknown projection type: ${type}. Available: ${Object.keys(PROJECTION_TYPES).join(', ')}`);
  const url = `${FANGRAPHS_BASE}?pos=all&stats=bat&type=${encodeURIComponent(fgType)}&team=0&lg=all&players=0`;
  return fetchJSON(url);
}

function fetchPitchingProjections(type) {
  const fgType = PROJECTION_TYPES[type];
  if (!fgType) throw new Error(`Unknown projection type: ${type}. Available: ${Object.keys(PROJECTION_TYPES).join(', ')}`);
  const url = `${FANGRAPHS_BASE}?pos=all&stats=pit&type=${encodeURIComponent(fgType)}&team=0&lg=all&players=0`;
  return fetchJSON(url);
}

// ── Update routines ─────────────────────────────────────────────────────────

async function updateRosters() {
  console.log('Fetching rosters...');
  const rosters = await fetchRosters();
  writeData(FILES.rosters, rosters);

  console.log('Fetching players...');
  const players = await fetchPlayers();
  writeData(FILES.players, players);

  console.log('Fetching league info...');
  const info = await fetchLeagueInfo();
  writeData(FILES.leagueInfo, info);
}

async function updateProjections(type) {
  type = type || 'steamer';
  console.log(`Fetching ${type} batting projections...`);
  const bat = await fetchBattingProjections(type);
  writeData(path.join(DATA_DIR, `${type}_batting.json`), bat);

  console.log(`Fetching ${type} pitching projections...`);
  const pit = await fetchPitchingProjections(type);
  writeData(path.join(DATA_DIR, `${type}_pitching.json`), pit);
}

async function updateAll() {
  await updateRosters();
  await updateProjections('steamer');
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const start = Date.now();

  try {
    if (args.includes('--rosters')) {
      await updateRosters();
    } else if (args.includes('--projections')) {
      // Collect type names after --projections (default to steamer)
      const idx = args.indexOf('--projections');
      const types = args.slice(idx + 1).filter(a => !a.startsWith('--'));
      if (types.length === 0) types.push('steamer');
      for (const t of types) {
        await updateProjections(t);
      }
    } else {
      await updateAll();
    }
    console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

// Allow importing as a module or running directly
if (require.main === module) {
  main();
}

module.exports = {
  updateAll, updateRosters, updateProjections,
  fetchRosters, fetchPlayers, fetchBattingProjections, fetchPitchingProjections,
  PROJECTION_TYPES,
};
