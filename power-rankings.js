/*
 * Keeper League Power Rankings — Projection-Based
 * 10-Category League:
 *   Hitting: HR, RBI, TB, OPS, SBN (net steals)
 *   Pitching: K, ERA, WHIP, W+QS, SVH
 *
 * Method: Aggregate projected stats per team using a pluggable projection
 * provider (see projections.js), rank each team 1-10 in every category.
 */

const CATEGORIES = [
  { key: 'HR',   label: 'HR',   type: 'hitting',  higher: true },
  { key: 'RBI',  label: 'RBI',  type: 'hitting',  higher: true },
  { key: 'TB',   label: 'TB',   type: 'hitting',  higher: true },
  { key: 'OPS',  label: 'OPS',  type: 'hitting',  higher: true },
  { key: 'SBN',  label: 'SBN',  type: 'hitting',  higher: true },
  { key: 'K',    label: 'K',    type: 'pitching', higher: true },
  { key: 'ERA',  label: 'ERA',  type: 'pitching', higher: false },
  { key: 'WHIP', label: 'WHIP', type: 'pitching', higher: false },
  { key: 'WQS',  label: 'W+QS', type: 'pitching', higher: true },
  { key: 'SVH',  label: 'SVH',  type: 'pitching', higher: true },
];

// Fantrax -> FanGraphs team abbreviation mapping
const TEAM_ABBR_MAP = {
  KC: 'KCR', TB: 'TBR', SD: 'SDP', SF: 'SFG', WAS: 'WSN'
};

// ── Name normalization & matching ──

function normalizeName(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bjr\.?\b/gi, '')
    .replace(/\bsr\.?\b/gi, '')
    .replace(/\b(ii|iii|iv|v)\b/gi, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fantraxNameToNormal(fantraxName) {
  // Strip Fantrax two-way player suffixes: "Ohtani-P, Shohei" -> "Ohtani, Shohei"
  const cleaned = fantraxName.replace(/-[A-Z]\b/g, '');
  // "Ramirez, Jose" -> "jose ramirez"
  const parts = cleaned.split(',').map(s => s.trim());
  if (parts.length >= 2) return normalizeName(parts[1] + ' ' + parts[0]);
  return normalizeName(cleaned);
}

function buildProjectionLookup(data, provider) {
  const byName = {};
  for (const p of data) {
    const key = normalizeName(provider.getPlayerName(p));
    if (!byName[key]) byName[key] = [];
    byName[key].push(p);
  }
  return byName;
}

function findProjection(fantraxPlayer, lookup, provider) {
  const key = fantraxNameToNormal(fantraxPlayer.name);
  const candidates = lookup[key];
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Disambiguate by team
  const fgTeam = TEAM_ABBR_MAP[fantraxPlayer.team] || fantraxPlayer.team;
  return candidates.find(c => provider.getTeam(c) === fgTeam) || candidates[0];
}

function isPlayerPitcher(id, players) {
  const p = players[id];
  return p && (p.position === 'SP' || p.position === 'RP');
}

// ── Team projection ──

function projectTeam(teamData, players, batLookup, pitLookup, provider) {
  const roster = teamData.rosterItems;
  const activeHitters = roster.filter(r => r.status === 'ACTIVE' && r.position !== 'P');
  const activePitchers = roster.filter(r => r.status === 'ACTIVE' && r.position === 'P');
  const reserves = roster.filter(r => r.status === 'RESERVE');

  // Batting aggregation
  const bat = { HR: 0, RBI: 0, H: 0, BB: 0, HBP: 0, PA: 0, AB: 0, SF: 0, TB: 0, SB: 0, CS: 0 };
  let matchedHitters = 0;
  const playerDetails = [];

  for (const r of activeHitters) {
    const p = players[r.id];
    if (!p) { playerDetails.push(makeRow(r, null, 'hitter')); continue; }
    const proj = findProjection(p, batLookup, provider);
    if (proj) {
      matchedHitters++;
      const s = provider.extractBatting(proj);

      bat.HR += s.HR; bat.RBI += s.RBI; bat.TB += s.TB;
      bat.H += s.H; bat.BB += s.BB;
      bat.HBP += s.HBP; bat.SF += s.SF;
      bat.PA += s.PA; bat.AB += s.AB;
      bat.SB += s.SB; bat.CS += s.CS;

      playerDetails.push({
        id: r.id, name: p.name, team: p.team, slot: r.position,
        status: 'ACTIVE', type: 'hitter', matched: true,
        stats: {
          HR: s.HR, RBI: s.RBI, TB: Math.round(s.TB),
          OPS: s.OPS, SB: s.SB, CS: s.CS,
          SBN: s.SBN, PA: s.PA
        }
      });
    } else {
      playerDetails.push(makeRow(r, p, 'hitter'));
    }
  }

  // Compute team OPS from aggregates (proper roto calculation)
  const obpDenom = bat.AB + bat.BB + bat.HBP + bat.SF;
  const teamOBP = obpDenom > 0 ? (bat.H + bat.BB + bat.HBP) / obpDenom : 0;
  const teamSLG = bat.AB > 0 ? bat.TB / bat.AB : 0;

  // Pitching aggregation
  const pit = { K: 0, ER: 0, IP: 0, H: 0, BB: 0, W: 0, QS: 0, SV: 0, HLD: 0 };
  let matchedPitchers = 0;

  for (const r of activePitchers) {
    const p = players[r.id];
    if (!p) { playerDetails.push(makeRow(r, null, 'pitcher')); continue; }
    const proj = findProjection(p, pitLookup, provider);
    if (proj) {
      matchedPitchers++;
      const s = provider.extractPitching(proj);

      pit.K += s.K; pit.ER += s.ER; pit.IP += s.IP;
      pit.H += s.H; pit.BB += s.BB;
      pit.W += s.W; pit.QS += s.QS; pit.SV += s.SV; pit.HLD += s.HLD;

      playerDetails.push({
        id: r.id, name: p.name, team: p.team, slot: 'P',
        status: 'ACTIVE', type: 'pitcher', matched: true,
        pitcherType: provider.isReliever(s, p) ? 'RP' : 'SP',
        stats: {
          K: s.K, ERA: s.ERA, WHIP: s.WHIP,
          W: s.W, QS: s.QS, SV: s.SV, HLD: s.HLD, IP: s.IP,
          WQS: s.WQS, SVH: s.SVH
        }
      });
    } else {
      playerDetails.push(makeRow(r, p, 'pitcher'));
    }
  }

  // Reserves (display only, no stat aggregation)
  for (const r of reserves) {
    const p = players[r.id];
    const type = isPlayerPitcher(r.id, players) ? 'pitcher' : 'hitter';
    playerDetails.push({
      id: r.id, name: p ? p.name : 'Unknown', team: p ? p.team : '?',
      slot: r.position, status: 'RESERVE', type, matched: false, stats: null
    });
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
    matchedCount: matchedHitters + matchedPitchers,
    totalActive: activeHitters.length + activePitchers.length,
    playerDetails,
  };
}

function makeRow(rosterItem, player, type) {
  return {
    id: rosterItem.id, name: player ? player.name : 'Unknown',
    team: player ? player.team : '?', slot: rosterItem.position,
    status: rosterItem.status, type, matched: false, stats: null
  };
}

// ── Category Rankings (Roto-Style Points) ──

function rankTeams(teams) {
  for (const cat of CATEGORIES) {
    // Sort teams by this category's stat
    const sorted = [...teams].sort((a, b) => {
      const av = a.projection.stats[cat.key], bv = b.projection.stats[cat.key];
      return cat.higher ? bv - av : av - bv; // best first
    });

    // Assign points: 10 for best, 1 for worst (handle ties by averaging)
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length - 1 &&
        Math.abs(sorted[j + 1].projection.stats[cat.key] - sorted[i].projection.stats[cat.key]) < 0.001) {
        j++;
      }
      const avgPoints = (sorted.length - i + sorted.length - j) / 2;
      for (let k = i; k <= j; k++) {
        sorted[k].catRank[cat.key] = { rank: i + 1, points: avgPoints };
      }
      i = j + 1;
    }
  }

  // Total points
  for (const t of teams) {
    t.totalPoints = 0;
    for (const cat of CATEGORIES) t.totalPoints += t.catRank[cat.key].points;
  }
}

// ── Data Loading ──

async function loadAllData(provider) {
  const [rostersR, playersR, batR, pitR] = await Promise.all([
    fetch('data/fantrax_rosters.json'),
    fetch('data/fantrax_players.json'),
    fetch(provider.battingFile),
    fetch(provider.pitchingFile),
  ]);
  return {
    rosters: await rostersR.json(),
    players: await playersR.json(),
    batting: await batR.json(),
    pitching: await pitR.json(),
  };
}

function buildRankings(rosters, players, battingData, pitchingData, provider) {
  const batLookup = buildProjectionLookup(battingData, provider);
  const pitLookup = buildProjectionLookup(pitchingData, provider);

  const teams = [];
  for (const [teamId, teamData] of Object.entries(rosters.rosters)) {
    const projection = projectTeam(teamData, players, batLookup, pitLookup, provider);
    teams.push({ teamId, teamName: teamData.teamName, projection, catRank: {} });
  }

  rankTeams(teams);
  teams.sort((a, b) => b.totalPoints - a.totalPoints);
  return teams;
}

// ── Rendering ──

let currentRankings = [];

function renderRankings(sortByName) {
  const tbody = document.getElementById('rankings-body');
  tbody.innerHTML = '';

  const pointsSorted = [...currentRankings].sort((a, b) => b.totalPoints - a.totalPoints);
  const display = sortByName
    ? [...currentRankings].sort((a, b) => a.teamName.localeCompare(b.teamName))
    : pointsSorted;

  display.forEach(team => {
    const rank = pointsSorted.indexOf(team) + 1;
    const row = document.createElement('tr');
    row.dataset.teamId = team.teamId;

    const badgeClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';

    let cells = `
      <td><span class="rank-badge ${badgeClass}">${rank}</span></td>
      <td>
        <strong style="color:#fff">${escapeHtml(team.teamName)}</strong>
        <span class="match-badge">${team.projection.matchedCount}/${team.projection.totalActive}</span>
      </td>
    `;  

    for (const cat of CATEGORIES) {
      const cr = team.catRank[cat.key];
      const val = fmtStat(cat.key, team.projection.stats[cat.key]);
      const color = getRankColor(cr.rank, currentRankings.length);
      cells += `<td class="cat-cell"><span style="color:${color}">${val}</span><br><span style="font-size:0.65rem;color:#888">#${cr.rank}</span></td>`;
    }

    row.innerHTML = cells;
    row.addEventListener('click', () => showTeamDetail(team));
    tbody.appendChild(row);
  });

  document.getElementById('last-updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

function getRankColor(rank, total) {
  if (rank <= 2) return '#4caf50';
  if (rank <= 4) return '#66bb6a';
  if (rank <= 6) return '#f59e0b';
  if (rank <= 8) return '#ff8a65';
  return '#ef4444';
}

function fmtStat(key, value) {
  switch (key) {
    case 'OPS': case 'WHIP': return value.toFixed(3);
    case 'ERA': return value.toFixed(2);
    case 'SBN': case 'WQS': case 'SVH': return value.toFixed(1);
    default: return String(Math.round(value));
  }
}

function showTeamDetail(team) {
  const panel = document.getElementById('team-detail');
  panel.className = 'team-detail active';

  const hitters = team.projection.playerDetails.filter(p => p.type === 'hitter' && p.status === 'ACTIVE');
  const pitchers = team.projection.playerDetails.filter(p => p.type === 'pitcher' && p.status === 'ACTIVE');
  const reserves = team.projection.playerDetails.filter(p => p.status === 'RESERVE');
  const unmatched = team.projection.playerDetails.filter(p => p.status === 'ACTIVE' && !p.matched);
  const matchPct = Math.round((team.projection.matchedCount / team.projection.totalActive) * 100);

  panel.innerHTML = `
    <div class="team-detail-header">
      <h3>${escapeHtml(team.teamName)} &mdash; Projection Breakdown</h3>
      <button class="close-btn" id="close-detail">&times; Close</button>
    </div>
    <div class="detail-body">
      <div class="breakdown-grid">
        <div class="breakdown-card"><div class="val">${matchPct}%</div><div class="lbl">Match Rate</div></div>
      </div>

      <h4 style="color:#fff;margin:16px 0 8px;font-size:0.95rem;">Category Projections &amp; Rankings</h4>
      <div class="cat-breakdown-grid">
        ${CATEGORIES.map(cat => {
          const val = fmtStat(cat.key, team.projection.stats[cat.key]);
          const cr = team.catRank[cat.key];
          const color = getRankColor(cr.rank, currentRankings.length);
          return '<div class="cat-card">' +
            '<div class="cat-label">' + cat.label + '</div>' +
            '<div class="cat-value">' + val + '</div>' +
            '<div class="cat-rank" style="color:' + color + '">#' + cr.rank + '</div>' +
          '</div>';
        }).join('')}
      </div>

      <div class="player-grid" style="margin-top:20px">
        <div class="player-section">
          <h4>Active Hitters (${hitters.length})</h4>
          <div style="overflow-x:auto">
            <table class="player-stat-table">
              <thead><tr><th>Slot</th><th>Player</th><th>HR</th><th>RBI</th><th>TB</th><th>OPS</th><th>SBN</th></tr></thead>
              <tbody>${hitters.map(p => renderHitterRow(p)).join('')}</tbody>
            </table>
          </div>
        </div>
        <div class="player-section">
          <h4>Active Pitchers (${pitchers.length})</h4>
          <div style="overflow-x:auto">
            <table class="player-stat-table">
              <thead><tr><th>Slot</th><th>Player</th><th>IP</th><th>K</th><th>ERA</th><th>WHIP</th><th>W+QS</th><th>SVH</th></tr></thead>
              <tbody>${pitchers.map(p => renderPitcherRow(p)).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>

      ${reserves.length > 0 ? '<h4 style="color:#888;margin:16px 0 8px;font-size:0.85rem;">Reserves (' + reserves.length + ')</h4><div class="reserves-list">' + reserves.map(p => '<span class="reserve-pill">' + escapeHtml(p.name) + ' <span class="reserve-pos">' + escapeHtml(p.slot) + '</span></span>').join('') + '</div>' : ''}

      ${unmatched.length > 0 ? '<div class="unmatched-note"><strong>\u26A0 ' + unmatched.length + ' active player(s) without projections:</strong> ' + unmatched.map(p => escapeHtml(p.name)).join(', ') + '</div>' : ''}
    </div>`;

  document.getElementById('close-detail').addEventListener('click', () => {
    panel.className = 'team-detail';
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderHitterRow(p) {
  if (!p.matched) {
    return '<tr class="unmatched"><td>' + escapeHtml(p.slot) + '</td><td>' + escapeHtml(p.name) + '</td><td colspan="5" class="no-proj">No projection</td></tr>';
  }
  const s = p.stats;
  return '<tr><td>' + escapeHtml(p.slot) + '</td><td>' + escapeHtml(p.name) +
    '</td><td>' + Math.round(s.HR) + '</td><td>' + Math.round(s.RBI) +
    '</td><td>' + Math.round(s.TB) + '</td><td>' + s.OPS.toFixed(3) +
    '</td><td>' + s.SBN.toFixed(1) + '</td></tr>';
}

function renderPitcherRow(p) {
  if (!p.matched) {
    return '<tr class="unmatched"><td>P</td><td>' + escapeHtml(p.name) + '</td><td colspan="6" class="no-proj">No projection</td></tr>';
  }
  const s = p.stats;
  const label = p.pitcherType ? 'P (' + p.pitcherType + ')' : 'P';
  return '<tr><td>' + label + '</td><td>' + escapeHtml(p.name) +
    '</td><td>' + s.IP.toFixed(1) + '</td><td>' + Math.round(s.K) +
    '</td><td>' + s.ERA.toFixed(2) + '</td><td>' + s.WHIP.toFixed(3) +
    '</td><td>' + s.WQS.toFixed(1) + '</td><td>' + s.SVH.toFixed(1) + '</td></tr>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── Init ──

let currentProvider = null;
let cachedLeagueData = null; // { rosters, players } — reused across provider switches
let availableProviders = []; // providers whose data files exist

async function detectAvailableProviders() {
  const all = ProjectionRegistry.list();
  const checks = all.map(async (p) => {
    try {
      const res = await fetch(p.battingFile, { method: 'HEAD' });
      return res.ok ? p : null;
    } catch {
      return null;
    }
  });
  return (await Promise.all(checks)).filter(Boolean);
}

function populateProviderDropdown(available) {
  const select = document.getElementById('projection-select');
  if (!select) return;
  select.innerHTML = '';
  for (const p of available) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === currentProvider.id) opt.selected = true;
    select.appendChild(opt);
  }
}

async function switchProvider(providerId) {
  const provider = ProjectionRegistry.get(providerId);
  if (!provider || !cachedLeagueData) return;

  currentProvider = provider;
  const tbody = document.getElementById('rankings-body');
  tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:32px;">Loading ' + escapeHtml(provider.name) + ' projections...</td></tr>';

  try {
    const [batR, pitR] = await Promise.all([
      fetch(provider.battingFile),
      fetch(provider.pitchingFile),
    ]);
    if (!batR.ok || !pitR.ok) throw new Error('Projection files not found');
    const batting = await batR.json();
    const pitching = await pitR.json();

    currentRankings = buildRankings(
      cachedLeagueData.rosters, cachedLeagueData.players,
      batting, pitching, provider
    );
    renderRankings(document.getElementById('sort-by-name').checked);
  } catch (err) {
    console.error('Failed to load projections:', err);
    tbody.innerHTML =
      '<tr><td colspan="12" style="text-align:center;padding:32px;color:#ef4444;">Error loading ' + escapeHtml(provider.name) + ' projections. Run <code>node data/api.js --projections ' + escapeHtml(provider.id) + '</code> to fetch the data.</td></tr>';
  }
}

async function init() {
  try {
    availableProviders = await detectAvailableProviders();
    currentProvider = availableProviders.find(p => p.id === ProjectionRegistry.defaultId)
      || availableProviders[0];

    if (!currentProvider) {
      document.getElementById('rankings-body').innerHTML =
        '<tr><td colspan="12" style="text-align:center;padding:32px;color:#ef4444;">No projection data found. Run <code>node data/api.js --projections steamer</code> to fetch data.</td></tr>';
      return;
    }

    populateProviderDropdown(availableProviders);

    const data = await loadAllData(currentProvider);
    cachedLeagueData = { rosters: data.rosters, players: data.players };

    currentRankings = buildRankings(
      data.rosters, data.players,
      data.batting, data.pitching,
      currentProvider
    );
    renderRankings(false);

    document.getElementById('rules-toggle').addEventListener('click', () => {
      document.getElementById('rules-body').classList.toggle('collapsed');
      document.querySelector('.toggle-icon').classList.toggle('collapsed');
    });

    document.getElementById('sort-by-name').addEventListener('change', e => {
      renderRankings(e.target.checked);
    });

    const projSelect = document.getElementById('projection-select');
    if (projSelect) {
      projSelect.addEventListener('change', e => {
        switchProvider(e.target.value);
      });
    }
  } catch (err) {
    console.error('Failed to load power rankings:', err);
    document.getElementById('rankings-body').innerHTML =
      '<tr><td colspan="12" style="text-align:center;padding:32px;color:#ef4444;">Error loading data. Check console.</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', init);
