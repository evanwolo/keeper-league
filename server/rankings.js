/**
 * Power Rankings Engine (Node.js)
 *
 * Reads roster, player, projection, and real-stats JSON files from disk
 * and computes blended power rankings for every projection system that has
 * data available.  Writes the results to data/power_rankings.json.
 *
 * 10-Category Roto league:
 *   Hitting:  HR, RBI, TB, OPS, SBN (net steals)
 *   Pitching: K, ERA, WHIP, W+QS, SVH
 */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const history = require('./history');
const { CATEGORIES, PROJECTION_SYSTEMS } = require('../shared/categories');
const { normalizeName, fantraxNameToNormal, buildProjectionLookup, findProjection } = require('../shared/normalize');

const DATA_DIR = config.dataDir;
const OUTPUT_FILE = path.join(DATA_DIR, 'power_rankings.json');

// Add 'real' system for YTD stats (not a true projection system, backend-only)
const ALL_SYSTEMS = [...PROJECTION_SYSTEMS, { id: 'real', name: 'Real YTD' }];

// ── Projection provider factory ────────────────────────────────────────────

const REAL_STATS_BATTING_FILE  = path.join(DATA_DIR, 'fangraphs_batting_stats.json');
const REAL_STATS_PITCHING_FILE = path.join(DATA_DIR, 'fangraphs_pitching_stats.json');

function createProvider(sys) {
  const battingFile  = sys.id === 'real' ? REAL_STATS_BATTING_FILE  : path.join(DATA_DIR, `${sys.id}_batting.json`);
  const pitchingFile = sys.id === 'real' ? REAL_STATS_PITCHING_FILE : path.join(DATA_DIR, `${sys.id}_pitching.json`);
  return {
    id: sys.id,
    name: sys.name,
    battingFile,
    pitchingFile,

    getPlayerName(row) { return row.PlayerName; },
    getTeam(row)       { return row.Team; },

    extractBatting(proj) {
      const hr      = +proj.HR  || 0;
      const rbi     = +proj.RBI || 0;
      const singles = +proj['1B'] || 0;
      const doubles = +proj['2B'] || 0;
      const triples = +proj['3B'] || 0;
      const tb      = singles + 2 * doubles + 3 * triples + 4 * hr;
      const sb      = +proj.SB || 0;
      const cs      = +proj.CS || 0;
      return {
        HR: hr, RBI: rbi, TB: tb,
        H:  +proj.H  || 0, BB: +proj.BB  || 0,
        HBP: +proj.HBP || 0, SF: +proj.SF || 0,
        PA: +proj.PA || 0, AB: +proj.AB || 0,
        SB: sb, CS: cs,
        OPS: +proj.OPS || 0,
        SBN: +(sb - cs).toFixed(1),
      };
    },

    extractPitching(proj) {
      const ip  = +proj.IP  || 0;
      const k   = +proj.SO  || 0;
      const w   = +proj.W   || 0;
      const qs  = +proj.QS  || 0;
      const sv  = +proj.SV  || 0;
      const hld = +proj.HLD || 0;
      return {
        IP: ip, K: k,
        ER: +proj.ER || 0, H: +proj.H || 0, BB: +proj.BB || 0,
        W: w, QS: qs, SV: sv, HLD: hld,
        ERA:  +proj.ERA  || 0,
        WHIP: +proj.WHIP || 0,
        WQS:  +(w + qs).toFixed(1),
        SVH:  +(sv + hld).toFixed(1),
        GS: +proj.GS || 0, G: +proj.G || 0,
      };
    },

    isReliever(pitchingStats, playerInfo) {
      return playerInfo.position === 'RP' ||
             pitchingStats.GS < pitchingStats.G / 2;
    },
  };
}

// ── Team projection ─────────────────────────────────────────────────────────

// Composite value score used to pick the "best" hitters/pitchers from the full pool
function hitterValue(s) {
  return s.HR * 2 + s.RBI + s.TB * 0.4 + s.SBN * 1.5 + s.OPS * 20 + s.PA * 0.01;
}

function pitcherValue(s) {
  return s.K * 0.5 + s.WQS * 3 + s.SVH * 2 + s.IP * 0.1
    - (s.ERA > 0 ? s.ERA * 2 : 0) - (s.WHIP > 0 ? s.WHIP * 5 : 0);
}

function projectTeam(teamData, players, batLookup, pitLookup, provider) {
  const roster = teamData.rosterItems;

  // Read league position constraints (loaded once from league_info.json)
  // Slots: C:1, 1B:1, 2B:1, 3B:1, SS:1, OF:3, UT:1, P:6
  const HITTER_SLOTS = [
    { slot: 'C',  count: 1, eligible: pos => pos === 'C' },
    { slot: '1B', count: 1, eligible: pos => pos === '1B' || pos === 'DH' },
    { slot: '2B', count: 1, eligible: pos => pos === '2B' },
    { slot: '3B', count: 1, eligible: pos => pos === '3B' },
    { slot: 'SS', count: 1, eligible: pos => pos === 'SS' },
    { slot: 'OF', count: 3, eligible: pos => ['LF','CF','RF','OF'].includes(pos) },
    // UT is filled last — any hitter
    { slot: 'UT', count: 1, eligible: () => true },
  ];
  const NUM_PITCHER_SLOTS = 6;

  // Pool all rostered non-IL players
  const availableHitters  = roster.filter(r => r.status !== 'INJURED_RESERVE' && r.position !== 'P');
  const availablePitchers = roster.filter(r => r.status !== 'INJURED_RESERVE' && r.position === 'P');

  // Score all hitters
  const hitterPool = [];
  for (const r of availableHitters) {
    const p = players[r.id];
    if (!p) continue;
    const rawProj = findProjection(p, batLookup, provider);
    const stats = rawProj ? provider.extractBatting(rawProj) : null;
    hitterPool.push({ r, p, stats, value: stats ? hitterValue(stats) : -Infinity });
  }
  hitterPool.sort((a, b) => b.value - a.value);

  // Fill hitter slots by position priority (specific positions first, UT last)
  const selectedHitterIds = new Set();
  const slotAssignments = {}; // playerId -> slot name

  for (const slotDef of HITTER_SLOTS) {
    let filled = 0;
    for (const h of hitterPool) {
      if (filled >= slotDef.count) break;
      if (selectedHitterIds.has(h.r.id)) continue;
      if (!h.stats) continue; // skip players without projections
      const naturalPos = h.p.position || h.r.position;
      if (slotDef.eligible(naturalPos)) {
        selectedHitterIds.add(h.r.id);
        slotAssignments[h.r.id] = slotDef.slot;
        filled++;
      }
    }
  }

  // Score all pitchers and pick top N
  const pitcherPool = [];
  for (const r of availablePitchers) {
    const p = players[r.id];
    if (!p) continue;
    const rawProj = findProjection(p, pitLookup, provider);
    const stats = rawProj ? provider.extractPitching(rawProj) : null;
    pitcherPool.push({ r, p, stats, value: stats ? pitcherValue(stats) : -Infinity });
  }
  pitcherPool.sort((a, b) => b.value - a.value);

  const selectedPitcherIds = new Set();
  for (const pit of pitcherPool) {
    if (selectedPitcherIds.size >= NUM_PITCHER_SLOTS) break;
    if (!pit.stats) continue;
    selectedPitcherIds.add(pit.r.id);
    slotAssignments[pit.r.id] = 'P';
  }

  // Build playerDetails
  const playerDetails = [];

  for (const h of hitterPool) {
    playerDetails.push({
      id: h.r.id,
      name: h.p.name || h.r.id,
      position: h.p.position || h.r.position,
      slot: slotAssignments[h.r.id] || null,
      status: h.r.status,
      type: 'hitter',
      selected: selectedHitterIds.has(h.r.id),
      stats: h.stats,
    });
  }

  for (const pit of pitcherPool) {
    playerDetails.push({
      id: pit.r.id,
      name: pit.p.name || pit.r.id,
      position: pit.p.position || pit.r.position,
      slot: slotAssignments[pit.r.id] || null,
      status: pit.r.status,
      type: 'pitcher',
      selected: selectedPitcherIds.has(pit.r.id),
      stats: pit.stats,
    });
  }

  // Add IL players for display
  for (const r of roster.filter(rr => rr.status === 'INJURED_RESERVE')) {
    const p = players[r.id];
    if (!p) continue;
    playerDetails.push({
      id: r.id,
      name: p.name || r.id,
      position: p.position || r.position,
      slot: null,
      status: r.status,
      type: r.position === 'P' ? 'pitcher' : 'hitter',
      selected: false,
      stats: null,
    });
  }

  // Batting aggregation (only selected hitters)
  const bat = { HR: 0, RBI: 0, H: 0, BB: 0, HBP: 0, PA: 0, AB: 0, SF: 0, TB: 0, SB: 0, CS: 0 };
  let matchedHitters = 0;

  for (const h of hitterPool) {
    if (!selectedHitterIds.has(h.r.id) || !h.stats) continue;
    matchedHitters++;
    const s = h.stats;
    bat.HR += s.HR; bat.RBI += s.RBI; bat.TB += s.TB;
    bat.H += s.H; bat.BB += s.BB;
    bat.HBP += s.HBP; bat.SF += s.SF;
    bat.PA += s.PA; bat.AB += s.AB;
    bat.SB += s.SB; bat.CS += s.CS;
  }

  const obpDenom = bat.AB + bat.BB + bat.HBP + bat.SF;
  const teamOBP = obpDenom > 0 ? (bat.H + bat.BB + bat.HBP) / obpDenom : 0;
  const teamSLG = bat.AB > 0 ? bat.TB / bat.AB : 0;

  // Pitching aggregation (only selected pitchers)
  const pit = { K: 0, ER: 0, IP: 0, H: 0, BB: 0, W: 0, QS: 0, SV: 0, HLD: 0 };
  let matchedPitchers = 0;

  for (const pp of pitcherPool) {
    if (!selectedPitcherIds.has(pp.r.id) || !pp.stats) continue;
    matchedPitchers++;
    const s = pp.stats;
    pit.K += s.K; pit.ER += s.ER; pit.IP += s.IP;
    pit.H += s.H; pit.BB += s.BB;
    pit.W += s.W; pit.QS += s.QS; pit.SV += s.SV; pit.HLD += s.HLD;
  }

  return {
    stats: {
      HR:   Math.round(bat.HR),
      RBI:  Math.round(bat.RBI),
      TB:   Math.round(bat.TB),
      OPS:  +(teamOBP + teamSLG).toFixed(3),
      SBN:  +(bat.SB - bat.CS).toFixed(1),
      K:    Math.round(pit.K),
      ERA:  pit.IP > 0 ? +((pit.ER * 9) / pit.IP).toFixed(2) : 99,
      WHIP: pit.IP > 0 ? +((pit.H + pit.BB) / pit.IP).toFixed(3) : 99,
      WQS:  +(pit.W + pit.QS).toFixed(1),
      SVH:  +(pit.SV + pit.HLD).toFixed(1),
    },
    playerDetails,
    matchedHitters,
    matchedPitchers,
    totalActive: selectedHitterIds.size + selectedPitcherIds.size,
  };
}

// ── Category ranking (roto-style points) ────────────────────────────────────

function rankTeams(teams) {
  const numTeams = teams.length;

  for (const cat of CATEGORIES) {
    const sorted = [...teams].sort((a, b) => {
      const av = a.stats[cat.key], bv = b.stats[cat.key];
      return cat.higher ? bv - av : av - bv;
    });

    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length - 1 &&
        Math.abs(sorted[j + 1].stats[cat.key] - sorted[i].stats[cat.key]) < 0.001) {
        j++;
      }
      const avgPoints = (numTeams - i + numTeams - j) / 2;
      for (let k = i; k <= j; k++) {
        sorted[k].catRanks[cat.key] = { rank: i + 1, points: avgPoints };
      }
      i = j + 1;
    }
  }

  for (const t of teams) {
    t.totalPoints = 0;
    for (const cat of CATEGORIES) t.totalPoints += t.catRanks[cat.key].points;
  }
}

// ── Blending ────────────────────────────────────────────────────────────────

const DEFAULT_REAL_STATS_WEIGHT = 0.35;

function getAutoRealStatsWeight(rosters) {
  const period = Number(rosters && rosters.period);
  if (!Number.isFinite(period)) return DEFAULT_REAL_STATS_WEIGHT;
  const progress = Math.min(Math.max((period - 1) / 26, 0), 1);
  return +(0.30 + progress * 0.30).toFixed(2);
}

function blendedStat(projected, actual, weight) {
  if (!Number.isFinite(actual)) return projected;
  return projected * (1 - weight) + actual * weight;
}

function applyRealStats(teamEntry, realTeamStats, weight) {
  if (!realTeamStats) {
    teamEntry.adjustment = { applied: false, weight, source: 'projection-only' };
    return;
  }

  const blendedStats = { ...teamEntry.stats };
  for (const cat of CATEGORIES) {
    const actualValue = Number(realTeamStats[cat.key]);
    if (Number.isFinite(actualValue)) {
      blendedStats[cat.key] = +blendedStat(teamEntry.stats[cat.key], actualValue, weight).toFixed(3);
    }
  }

  teamEntry.projectedStats = { ...teamEntry.stats };
  teamEntry.stats = blendedStats;
  teamEntry.adjustment = {
    applied: true,
    weight,
    source: 'fantrax-real-stats',
    actual: realTeamStats,
  };
}

// ── Build team-level real stats from FanGraphs player files ────────────────

function buildRealTeamStats(rosters, players) {
  const bat = readOptionalJSON(REAL_STATS_BATTING_FILE);
  const pit = readOptionalJSON(REAL_STATS_PITCHING_FILE);
  if (!bat || !pit) return null;

  const realProvider = createProvider({ id: 'real', name: 'Real YTD' });
  const batLookup = buildProjectionLookup(bat, realProvider);
  const pitLookup = buildProjectionLookup(pit, realProvider);

  const teams = {};
  for (const [teamId, teamData] of Object.entries(rosters.rosters)) {
    const proj = projectTeam(teamData, players, batLookup, pitLookup, realProvider);
    teams[teamId] = { teamName: teamData.teamName, stats: proj.stats };
  }
  return { sourceMethod: 'fangraphs-player-stats', teams };
}

// ── File helpers ────────────────────────────────────────────────────────────

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readOptionalJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data;
  } catch {
    return null;
  }
}

function writeOutput(data) {
  const tmp = OUTPUT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, OUTPUT_FILE);
  console.log(`  Saved ${path.basename(OUTPUT_FILE)}`);
}

// ── Main computation ────────────────────────────────────────────────────────

function computeRankingsForProvider(provider, rosters, players, realStats, weight) {
  let batting, pitching;
  try {
    batting  = readJSON(provider.battingFile);
    pitching = readJSON(provider.pitchingFile);
  } catch {
    return null; // projection files not available for this system
  }

  const batLookup = buildProjectionLookup(batting, provider);
  const pitLookup = buildProjectionLookup(pitching, provider);

  const teams = [];
  for (const [teamId, teamData] of Object.entries(rosters.rosters)) {
    const projection = projectTeam(teamData, players, batLookup, pitLookup, provider);
    teams.push({
      teamId,
      teamName: teamData.teamName,
      stats: projection.stats,
      playerDetails: projection.playerDetails,
      matchedHitters: projection.matchedHitters,
      matchedPitchers: projection.matchedPitchers,
      totalActive: projection.totalActive,
      catRanks: {},
    });
  }

  // Apply real stats blending
  const hasReal = realStats && realStats.teams && Object.keys(realStats.teams).length > 0;
  for (const team of teams) {
    const actual = hasReal && realStats.teams[team.teamId]
      ? realStats.teams[team.teamId].stats
      : null;
    applyRealStats(team, actual, weight);
  }

  // Rank
  rankTeams(teams);
  teams.sort((a, b) => b.totalPoints - a.totalPoints);

  return teams.map((t, i) => ({
    rank: i + 1,
    teamId: t.teamId,
    teamName: t.teamName,
    totalPoints: +t.totalPoints.toFixed(1),
    stats: t.stats,
    projectedStats: t.projectedStats || t.stats,
    catRanks: t.catRanks,
    matchedHitters: t.matchedHitters,
    matchedPitchers: t.matchedPitchers,
    totalActive: t.totalActive,
    adjustment: t.adjustment,
    playerDetails: t.playerDetails || [],
  }));
}

async function generateRankings() {
  console.log('Computing power rankings...');

  const rosters  = readJSON(path.join(DATA_DIR, 'fantrax_rosters.json'));
  const players  = readJSON(path.join(DATA_DIR, 'fantrax_players.json'));
  const realStats = buildRealTeamStats(rosters, players);

  const weight = getAutoRealStatsWeight(rosters);
  const hasReal = realStats && realStats.teams && Object.keys(realStats.teams).length > 0;

  console.log(`  Real-stats weight: ${Math.round(weight * 100)}%${hasReal ? '' : ' (no real data available)'}`);

  const bySystem = {};
  let primaryRankings = null;

  for (const sys of ALL_SYSTEMS) {
    const provider = createProvider(sys);
    // No blending — projection systems use pure projections, Real YTD uses pure actuals
    const rankings = computeRankingsForProvider(provider, rosters, players, null, 0);
    if (rankings) {
      bySystem[sys.id] = {
        name: sys.name,
        rankings,
      };
      if (!primaryRankings) primaryRankings = sys.id;
      console.log(`  ${sys.name}: ${rankings.length} teams ranked`);
    } else {
      console.log(`  ${sys.name}: skipped (no projection data)`);
    }
  }

  // Compute a consensus ranking by averaging total points across projection systems only
  // (exclude Real YTD — it's shown as its own system, not blended into consensus)
  const projectionSystems = {};
  for (const [id, sys] of Object.entries(bySystem)) {
    if (id !== 'real') projectionSystems[id] = sys;
  }
  const consensus = computeConsensus(projectionSystems);

  const output = {
    generatedAt: new Date().toISOString(),
    serverDate: history.toDateKey(new Date()),
    leagueId: config.leagueId,
    period: rosters.period || null,
    realStatsWeight: weight,
    realStatsAvailable: hasReal,
    realStatsSource: hasReal ? (realStats.sourceMethod || 'fangraphs-player-stats') : null,
    categories: CATEGORIES.map(c => ({ key: c.key, label: c.label, type: c.type, higher: c.higher })),
    primarySystem: primaryRankings,
    systems: bySystem,
    consensus,
  };

  writeOutput(output);

  // Append today's snapshot to history
  try {
    history.appendEntry(output);
  } catch (err) {
    console.warn('  History: failed to append entry:', err.message);
  }

  return output;
}

// ── Consensus ranking ───────────────────────────────────────────────────────

function computeConsensus(bySystem) {
  const systemIds = Object.keys(bySystem);
  if (systemIds.length === 0) return null;
  if (systemIds.length === 1) {
    return { note: 'single-system', ...bySystem[systemIds[0]] };
  }

  // Collect all team IDs from first system
  const firstRankings = bySystem[systemIds[0]].rankings;
  const teamIds = firstRankings.map(t => t.teamId);

  const consensusTeams = teamIds.map(teamId => {
    let totalPointsSum = 0;
    const catPointsSums = {};
    const statsSums = {};

    for (const cat of CATEGORIES) {
      catPointsSums[cat.key] = 0;
      statsSums[cat.key] = 0;
    }

    let count = 0;
    let teamName = '';

    for (const sysId of systemIds) {
      const entry = bySystem[sysId].rankings.find(t => t.teamId === teamId);
      if (!entry) continue;
      count++;
      teamName = entry.teamName;
      totalPointsSum += entry.totalPoints;
      for (const cat of CATEGORIES) {
        catPointsSums[cat.key] += entry.catRanks[cat.key].points;
        statsSums[cat.key] += entry.stats[cat.key];
      }
    }

    const avgStats = {};
    const avgCatPoints = {};
    let playerDetails = [];
    for (const cat of CATEGORIES) {
      avgStats[cat.key] = +(statsSums[cat.key] / count).toFixed(3);
      avgCatPoints[cat.key] = +(catPointsSums[cat.key] / count).toFixed(1);
    }
    // Use the first system's playerDetails for roster display (same players, different stat projections)
    for (const sysId of systemIds) {
      const entry = bySystem[sysId].rankings.find(t => t.teamId === teamId);
      if (entry && entry.playerDetails && entry.playerDetails.length) {
        playerDetails = entry.playerDetails;
        break;
      }
    }

    return {
      teamId,
      teamName,
      totalPoints: +(totalPointsSum / count).toFixed(1),
      avgStats,
      avgCatPoints,
      playerDetails,
      systemCount: count,
    };
  });

  // Compute per-category ranks from avgStats so the frontend shape is uniform
  for (const cat of CATEGORIES) {
    const sorted = [...consensusTeams].sort((a, b) =>
      cat.higher ? b.avgStats[cat.key] - a.avgStats[cat.key] : a.avgStats[cat.key] - b.avgStats[cat.key]
    );
    let ci = 0;
    while (ci < sorted.length) {
      let cj = ci;
      while (cj < sorted.length - 1 &&
        Math.abs(sorted[cj + 1].avgStats[cat.key] - sorted[ci].avgStats[cat.key]) < 0.001) cj++;
      const avgPts = (sorted.length - ci + sorted.length - cj) / 2;
      for (let k = ci; k <= cj; k++) {
        if (!sorted[k].catRanks) sorted[k].catRanks = {};
        sorted[k].catRanks[cat.key] = { rank: ci + 1, points: avgPts };
      }
      ci = cj + 1;
    }
  }

  // Add stats alias so frontend transform is uniform (same as per-system entries)
  for (const t of consensusTeams) {
    t.stats = t.avgStats;
  }

  consensusTeams.sort((a, b) => b.totalPoints - a.totalPoints);
  consensusTeams.forEach((t, i) => { t.rank = i + 1; });

  return {
    name: 'Consensus',
    systemsUsed: systemIds,
    rankings: consensusTeams,
  };
}

module.exports = { generateRankings, CATEGORIES };
