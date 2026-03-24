/**
 * Fantrax API Wrapper — Fetches and updates league data files.
 *
 * Usage:
 *   node data/api.js                           # update rosters + steamer projections (+ real stats if available)
 *   node data/api.js --rosters                  # update rosters + players only
 *   node data/api.js --projections [type]       # update projections (default: steamer)
 *   node data/api.js --projections steamer zips # update multiple projection types
 *   node data/api.js --real-stats [period]      # update team category totals from Fantrax
 *
 * Projection types: steamer, zips, atc, thebat, thebatx, dc
 *
 * Environment:
 *   FANTRAX_LEAGUE_ID   — your league ID (default from config below)
 *   FANTRAX_COOKIE      — optional Fantrax session cookie for authenticated endpoints
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
const FANTRAX_COOKIE = process.env.FANTRAX_COOKIE || '';

const FANTRAX_BASE = 'https://www.fantrax.com/fxpa/req';
const FANGRAPHS_BASE = 'https://www.fangraphs.com/api/projections';

const FILES = {
  rosters: path.join(DATA_DIR, 'fantrax_rosters.json'),
  players: path.join(DATA_DIR, 'fantrax_players.json'),
  steamerBat: path.join(DATA_DIR, 'steamer_batting.json'),
  steamerPit: path.join(DATA_DIR, 'steamer_pitching.json'),
  leagueInfo: path.join(DATA_DIR, 'league_info.json'),
  realStats: path.join(DATA_DIR, 'fantrax_real_stats.json'),
  realStatsRaw: path.join(DATA_DIR, 'fantrax_real_stats_raw.json'),
};

const CATEGORY_ALIASES = {
  HR: 'HR',
  HOMERUNS: 'HR',
  RBI: 'RBI',
  RUNSBATTEDIN: 'RBI',
  TB: 'TB',
  TOTALBASES: 'TB',
  OPS: 'OPS',
  K: 'K',
  SO: 'K',
  STRIKEOUTS: 'K',
  ERA: 'ERA',
  WHIP: 'WHIP',
  W: 'W',
  WINS: 'W',
  QS: 'QS',
  QUALITYSTARTS: 'QS',
  SV: 'SV',
  SAVES: 'SV',
  HLD: 'HLD',
  HOLDS: 'HLD',
  SB: 'SB',
  STOLENBASES: 'SB',
  CS: 'CS',
  CAUGHTSTEALING: 'CS',
  SBN: 'SBN',
  NETSB: 'SBN',
  WQS: 'WQS',
  SVH: 'SVH',
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

function fantraxHeaders() {
  return FANTRAX_COOKIE ? { Cookie: FANTRAX_COOKIE } : {};
}

function normalizeApiError(resp) {
  const top = resp && resp.pageError && resp.pageError.code ? resp.pageError : null;
  const nested = resp && resp.responses && resp.responses[0] && resp.responses[0].pageError
    ? resp.responses[0].pageError
    : null;
  return top || nested || null;
}

async function postFantrax(method, data) {
  const resp = await fetchJSON(FANTRAX_BASE, {
    method: 'POST',
    body: JSON.stringify({ msgs: [{ method, data }] }),
    headers: fantraxHeaders(),
  });

  const err = normalizeApiError(resp);
  if (err && err.code && !String(err.code).startsWith('WARNING_')) {
    throw new Error(err.text || err.code || `Fantrax call failed: ${method}`);
  }

  return resp;
}

function writeData(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
  console.log(`  Saved ${path.basename(filePath)}`);
}

// ── Fantrax API ─────────────────────────────────────────────────────────────

async function fetchRosters(period) {
  const resp = await postFantrax('getTeamRosters', {
    leagueId: LEAGUE_ID,
    ...(period != null && { period }),
  });
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
  const resp = await postFantrax('getPlayerIds', { leagueId: LEAGUE_ID });
  const playerMap = resp.responses?.[0]?.data;
  if (!playerMap) throw new Error('Unexpected players response structure');

  return playerMap;
}

async function fetchLeagueInfo() {
  try {
    const resp = await postFantrax('getLeagueInfo', { leagueId: LEAGUE_ID });
    return resp.responses?.[0]?.data || {};
  } catch (err) {
    console.warn(`  Skipping league info fetch: ${err.message}`);
    return {};
  }
}

function toNumber(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatKey(key) {
  const cleaned = String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CATEGORY_ALIASES[cleaned] || null;
}

function normalizeStatsObject(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const out = {};
  for (const [key, raw] of Object.entries(obj)) {
    const cat = normalizeStatKey(key);
    if (!cat) continue;
    const num = toNumber(raw);
    if (num == null) continue;
    out[cat] = num;
  }

  if (out.SBN == null && out.SB != null && out.CS != null) {
    out.SBN = +(out.SB - out.CS).toFixed(1);
  }
  if (out.WQS == null && out.W != null && out.QS != null) {
    out.WQS = +(out.W + out.QS).toFixed(1);
  }
  if (out.SVH == null && out.SV != null && out.HLD != null) {
    out.SVH = +(out.SV + out.HLD).toFixed(1);
  }

  return Object.keys(out).length >= 3 ? out : null;
}

function parseTeamStatsRow(row, teamNameToId) {
  if (!row || typeof row !== 'object') return null;

  const teamObj = row.team && typeof row.team === 'object' ? row.team : null;
  const teamName = row.teamName || row.name || row.franchiseName || row.ownerTeamName || (teamObj && teamObj.name);
  const teamId = row.teamId || row.franchiseId || row.ownerTeamId || (teamObj && teamObj.id) || (teamName && teamNameToId[teamName]);
  if (!teamId) return null;

  const statSources = [
    row.stats,
    row.teamStats,
    row.totals,
    row.scoringSummary,
    row.categoryTotals,
    row,
  ];

  for (const src of statSources) {
    const stats = normalizeStatsObject(src);
    if (stats) {
      return { teamId: String(teamId), teamName: teamName || null, stats };
    }
  }

  return null;
}

function extractTeamStatsFromNode(node, out, teamNameToId, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) {
    for (const item of node) extractTeamStatsFromNode(item, out, teamNameToId, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const parsed = parseTeamStatsRow(node, teamNameToId);
  if (parsed) {
    const existing = out[parsed.teamId];
    if (!existing || Object.keys(parsed.stats).length > Object.keys(existing.stats).length) {
      out[parsed.teamId] = parsed;
    }
  }

  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') {
      extractTeamStatsFromNode(val, out, teamNameToId, depth + 1);
    }
  }
}

function extractTeamStats(resp, teamNameToId) {
  const found = {};
  extractTeamStatsFromNode(resp, found, teamNameToId, 0);
  return found;
}

function readRostersFromDisk() {
  if (!fs.existsSync(FILES.rosters)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILES.rosters, 'utf8'));
  } catch {
    return null;
  }
}

function buildTeamNameLookup(rosters) {
  const map = {};
  if (!rosters || !rosters.rosters) return map;
  for (const [teamId, teamData] of Object.entries(rosters.rosters)) {
    if (teamData && teamData.teamName) {
      map[teamData.teamName] = teamId;
    }
  }
  return map;
}

async function fetchRealStats(period) {
  const candidates = [
    { method: 'getStandings', data: { leagueId: LEAGUE_ID, period } },
    { method: 'getStandings', data: { leagueId: LEAGUE_ID } },
  ];

  const rosters = readRostersFromDisk();
  const teamNameToId = buildTeamNameLookup(rosters);

  const errors = [];
  for (const candidate of candidates) {
    try {
      const resp = await postFantrax(candidate.method, candidate.data);
      const statsByTeam = extractTeamStats(resp, teamNameToId);
      if (Object.keys(statsByTeam).length > 0) {
        return {
          sourceMethod: candidate.method,
          raw: resp,
          teams: statsByTeam,
        };
      }
      errors.push(`${candidate.method}: no team stats found`);
    } catch (err) {
      errors.push(`${candidate.method}: ${err.message}`);
    }
  }

  throw new Error(`Could not fetch team stats from Fantrax (${errors.join('; ')})`);
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

async function updateRealStats(period) {
  console.log('Fetching real team stats from Fantrax...');
  const payload = await fetchRealStats(period);

  const teams = {};
  for (const [teamId, row] of Object.entries(payload.teams)) {
    teams[teamId] = {
      teamName: row.teamName || null,
      stats: row.stats,
    };
  }

  const normalized = {
    generatedAt: new Date().toISOString(),
    leagueId: LEAGUE_ID,
    period: period || null,
    sourceMethod: payload.sourceMethod,
    teams,
  };

  writeData(FILES.realStats, normalized);
  writeData(FILES.realStatsRaw, payload.raw);
}

async function tryUpdateRealStats(period) {
  try {
    await updateRealStats(period);
    return true;
  } catch (err) {
    console.warn(`  Skipped real-stats update: ${err.message}`);
    if (!FANTRAX_COOKIE) {
      console.warn('  Hint: set FANTRAX_COOKIE to access authenticated Fantrax stats endpoints.');
    }
    return false;
  }
}

async function updateAll() {
  await updateRosters();
  await updateProjections('steamer');
  await tryUpdateRealStats();
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const start = Date.now();

  try {
    if (args.includes('--rosters')) {
      await updateRosters();
    } else if (args.includes('--real-stats')) {
      const idx = args.indexOf('--real-stats');
      const maybePeriod = args[idx + 1];
      const period = maybePeriod && !maybePeriod.startsWith('--') ? Number(maybePeriod) : null;
      await updateRealStats(Number.isFinite(period) ? period : null);
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
  updateAll, updateRosters, updateProjections, updateRealStats,
  fetchRosters, fetchPlayers, fetchBattingProjections, fetchPitchingProjections, fetchRealStats,
  PROJECTION_TYPES,
};
