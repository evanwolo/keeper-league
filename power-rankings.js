/*
 * Keeper League Power Rankings — render-only frontend.
 * All stat computation is done server-side (server/rankings.js).
 * Loads data/power_rankings.json and renders it.
 */

const { CATEGORIES } = KeeperShared;

// ── State ──────────────────────────────────────────────────────────────────

let rankingsData    = null; // loaded power_rankings.json
let currentSystemId = null;
let currentRankings = [];   // [{teamId, teamName, totalPoints, projection, catRank}]
let rankingsDelta   = {};   // teamId → signed int (positive = moved up, negative = down)

// ── Data transform ─────────────────────────────────────────────────────────

function transformEntry(entry) {
  return {
    teamId: entry.teamId,
    teamName: entry.teamName,
    totalPoints: entry.totalPoints,
    projection: {
      stats: entry.stats || {},
      playerDetails: entry.playerDetails || [],
    },
    catRank: entry.catRanks || {},
  };
}

function setCurrentSystem(systemId) {
  const sysData = systemId === 'consensus'
    ? rankingsData.consensus
    : (rankingsData.systems && rankingsData.systems[systemId]);
  if (!sysData) return;
  currentSystemId = systemId;
  currentRankings = (sysData.rankings || []).map(transformEntry);
}

// ── Rendering ──

function renderRankings() {
  const tbody = document.getElementById('rankings-body');
  tbody.innerHTML = '';

  const pointsSorted = [...currentRankings].sort((a, b) => b.totalPoints - a.totalPoints);
  const display = pointsSorted;

  display.forEach(team => {
    const rank = pointsSorted.indexOf(team) + 1;
    const row = document.createElement('tr');
    row.dataset.teamId = team.teamId;

    const badgeClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';

    const d = rankingsDelta[team.teamId];
    // Only show badge if history data loaded; skip entirely if no entry for this team
    const deltaHtml = (d == null)
      ? ''
      : d === 0
        ? '<span class="delta flat">—</span>'
        : d > 0
          ? `<span class="delta up">&#9650;${d}</span>`
          : `<span class="delta down">&#9660;${Math.abs(d)}</span>`;

    let cells = `
      <td><span class="rank-badge ${badgeClass}">${rank}</span></td>
      <td>
        <strong style="color:#fff">${escapeHtml(team.teamName)}</strong>${deltaHtml}
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
}

function recomputeAndRender() {
  renderRankings();
}

// Color scale for rank percentile (0 = best, 1 = worst)
const RANK_COLOR_FIRST  = '#3b82f6'; // rank #1 always blue
const RANK_COLOR_WORST  = '#c62828';
const RANK_COLOR_STEPS  = [
  { threshold: 0.20, color: '#2e7d32' }, // top 20%
  { threshold: 0.40, color: '#66bb6a' },
  { threshold: 0.65, color: '#fbc02d' },
  { threshold: 0.85, color: '#ef6c00' },
];

function getRankColor(rank, total) {
  if (rank === 1) return RANK_COLOR_FIRST;
  const pct = (rank - 1) / Math.max(total - 1, 1);
  for (const { threshold, color } of RANK_COLOR_STEPS) {
    if (pct <= threshold) return color;
  }
  return RANK_COLOR_WORST;
}

function fmtStat(key, value) {
  const v = value ?? 0;
  switch (key) {
    case 'OPS': case 'WHIP': return v.toFixed(3);
    case 'ERA': return v.toFixed(2);
    case 'SBN': case 'WQS': case 'SVH': return v.toFixed(1);
    default: return String(Math.round(v));
  }
}

function showTeamDetail(team) {
  const panel = document.getElementById('team-detail');
  panel.className = 'team-detail active';

  const allHitters  = team.projection.playerDetails.filter(p => p.type === 'hitter' && p.status !== 'INJURED_RESERVE');
  const allPitchers = team.projection.playerDetails.filter(p => p.type === 'pitcher' && p.status !== 'INJURED_RESERVE');
  const il          = team.projection.playerDetails.filter(p => p.status === 'INJURED_RESERVE');

  // Normalized value: each category scaled 0-1 across the pool, then summed equally
  function normalizedPool(players, cats) {
    const withStats = players.filter(p => p.stats);
    const ranges = {};
    for (const key of cats) {
      const vals = withStats.map(p => p.stats[key]).filter(v => Number.isFinite(v));
      const min = Math.min(...vals), max = Math.max(...vals);
      ranges[key] = { min, max, range: max - min };
    }
    return p => {
      if (!p.stats) return -1;
      let score = 0;
      for (const key of cats) {
        const r = ranges[key];
        if (!r || r.range < 0.0001) continue;
        const raw = (p.stats[key] - r.min) / r.range;
        const cat = CATEGORIES.find(c => c.key === key);
        score += (cat && !cat.higher) ? (1 - raw) : raw;
      }
      return score;
    };
  }
  const hVal = normalizedPool(allHitters, ['HR','RBI','TB','OPS','SBN']);
  const pVal = normalizedPool(allPitchers, ['K','ERA','WHIP','WQS','SVH']);
  allHitters.sort((a, b) => hVal(b) - hVal(a));
  allPitchers.sort((a, b) => pVal(b) - pVal(a));

  const selectedCount = team.projection.playerDetails.filter(p => p.selected).length;

  panel.innerHTML = `
    <div class="team-detail-header">
      <h3>${escapeHtml(team.teamName)} &mdash; Projection Breakdown</h3>
      <button class="close-btn" id="close-detail">&times; Close</button>
    </div>
    <div class="detail-body">
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

      <div class="player-grid" style="margin-top:8px">
        <div class="player-section">
          <h4>Hitters (${allHitters.length})</h4>
          <div style="overflow-x:auto">
            <table class="player-stat-table">
              <thead><tr><th>#</th><th>Player</th><th>Pos</th><th>HR</th><th>RBI</th><th>TB</th><th>OPS</th><th>SBN</th></tr></thead>
              <tbody>${allHitters.map((p, i) => renderHitterRow(p, i + 1)).join('')}</tbody>
            </table>
          </div>
        </div>
        <div class="player-section">
          <h4>Pitchers (${allPitchers.length})</h4>
          <div style="overflow-x:auto">
            <table class="player-stat-table">
              <thead><tr><th>#</th><th>Player</th><th>Pos</th><th>IP</th><th>K</th><th>ERA</th><th>WHIP</th><th>W+QS</th><th>SVH</th></tr></thead>
              <tbody>${allPitchers.map((p, i) => renderPitcherRow(p, i + 1)).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>

      ${il.length > 0 ? '<h4 style="color:#888;margin:16px 0 8px;font-size:0.85rem;">Injured Reserve (' + il.length + ')</h4><div class="reserves-list">' + il.map(p => '<span class="reserve-pill" style="opacity:0.5">' + escapeHtml(p.name) + ' <span class="reserve-pos">IL</span></span>').join('') + '</div>' : ''}
    </div>`;

  document.getElementById('close-detail').addEventListener('click', () => {
    panel.className = 'team-detail';
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderHitterRow(p, rank) {
  const dim = p.selected ? '' : ' style="opacity:0.4"';
  if (!p.stats) {
    return '<tr' + dim + '><td>' + rank + '</td><td>' + escapeHtml(p.name) + '</td><td>' + escapeHtml(p.position) + '</td><td colspan="5" class="no-proj">No projection</td></tr>';
  }
  const s = p.stats;
  return '<tr' + dim + '><td>' + rank + '</td><td>' + escapeHtml(p.name) +
    '</td><td>' + escapeHtml(p.position) +
    '</td><td>' + Math.round(s.HR) + '</td><td>' + Math.round(s.RBI) +
    '</td><td>' + Math.round(s.TB) + '</td><td>' + s.OPS.toFixed(3) +
    '</td><td>' + s.SBN.toFixed(1) + '</td></tr>';
}

function renderPitcherRow(p, rank) {
  const dim = p.selected ? '' : ' style="opacity:0.4"';
  if (!p.stats) {
    return '<tr' + dim + '><td>' + rank + '</td><td>' + escapeHtml(p.name) + '</td><td>' + escapeHtml(p.position) + '</td><td colspan="6" class="no-proj">No projection</td></tr>';
  }
  const s = p.stats;
  return '<tr' + dim + '><td>' + rank + '</td><td>' + escapeHtml(p.name) +
    '</td><td>' + escapeHtml(p.position) +
    '</td><td>' + s.IP.toFixed(1) + '</td><td>' + Math.round(s.K) +
    '</td><td>' + s.ERA.toFixed(2) + '</td><td>' + s.WHIP.toFixed(3) +
    '</td><td>' + s.WQS.toFixed(1) + '</td><td>' + s.SVH.toFixed(1) + '</td></tr>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── History navigation ──

let liveServerDate = null;
let historyData = null;   // full history JSON { entries: [...] }
let histPastEntries = []; // entries before today (today is always shown as live)
let histDateIdx  = -1;    // -1 = live view; else index into histPastEntries
let histDelta    = {};    // teamId → signed delta vs the previous history entry

function localDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const LIVE_THEAD_HTML = `
  <tr>
    <th rowspan="2" style="width:44px">#</th>
    <th rowspan="2">Team</th>
    <th colspan="5" class="group-hit">Hitting</th>
    <th colspan="5" class="group-pit">Pitching</th>
  </tr>
  <tr>
    <th class="cat-hit">HR</th>
    <th class="cat-hit">RBI</th>
    <th class="cat-hit">TB</th>
    <th class="cat-hit">OPS</th>
    <th class="cat-hit">SBN</th>
    <th class="cat-pit">K</th>
    <th class="cat-pit">ERA</th>
    <th class="cat-pit">WHIP</th>
    <th class="cat-pit">W+QS</th>
    <th class="cat-pit">SVH</th>
  </tr>
`;

async function loadHistoryData(serverDate) {
  try {
    const resp = await fetch('data/power_rankings_history.json');
    if (!resp.ok) return;
    historyData = await resp.json();
    // Use the server's local date to filter — avoids browser timezone discrepancies
    const today = serverDate || localDateKey();
    histPastEntries = (historyData.entries || []).filter(e => e.date < today);
  } catch {
    historyData = null;
    histPastEntries = [];
  }
}

function buildHistoryNav() {
  const nav = document.getElementById('history-nav');
  if (histPastEntries.length === 0) {
    nav.style.visibility = 'hidden';
    return;
  }
  nav.style.visibility = 'visible';
  updateHistoryNavUI();

  document.getElementById('hist-prev').addEventListener('click', () => {
    if (histDateIdx === -1) {
      // Move from live to most recent past entry
      navigateHistory(histPastEntries.length - 1);
    } else if (histDateIdx > 0) {
      navigateHistory(histDateIdx - 1);
    }
  });

  document.getElementById('hist-next').addEventListener('click', () => {
    if (histDateIdx === -1) return;
    if (histDateIdx < histPastEntries.length - 1) {
      navigateHistory(histDateIdx + 1);
    } else {
      navigateHistory(-1); // last past entry → back to live
    }
  });

  document.getElementById('hist-live-btn').addEventListener('click', () => {
    navigateHistory(-1);
  });
}

function updateHistoryNavUI() {
  const prevBtn    = document.getElementById('hist-prev');
  const nextBtn    = document.getElementById('hist-next');
  const label      = document.getElementById('hist-date-label');
  const liveBtn    = document.getElementById('hist-live-btn');
  const retroBadge = document.getElementById('hist-retro-badge');

  const isLive = histDateIdx === -1;

  prevBtn.disabled = isLive ? histPastEntries.length === 0 : histDateIdx <= 0;
  nextBtn.disabled = isLive;

  if (isLive) {
    label.textContent = 'Live \u2014 Today';
    label.classList.add('is-live');
    liveBtn.style.display = 'none';
    retroBadge.style.display = 'none';
  } else {
    const entry = histPastEntries[histDateIdx];
    const d = new Date(entry.date + 'T12:00:00');
    const fmt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    label.textContent = fmt;
    label.classList.remove('is-live');
    liveBtn.style.display = '';
    retroBadge.style.display = entry.isRetroactive ? '' : 'none';
  }
}

function computeHistDelta(currentEntry) {
  // Find the entry just before the current one in histPastEntries
  let prevEntry = null;
  if (histDateIdx === -1) {
    // Live: compare against most recent past entry
    prevEntry = histPastEntries.length > 0 ? histPastEntries[histPastEntries.length - 1] : null;
  } else if (histDateIdx > 0) {
    prevEntry = histPastEntries[histDateIdx - 1];
  }

  if (!prevEntry || !prevEntry.consensus || !currentEntry.consensus) { histDelta = {}; return; }

  const prevRank = {};
  for (const t of (prevEntry.consensus.rankings || [])) prevRank[t.teamId] = t.rank;
  const curRank  = {};
  for (const t of (currentEntry.consensus.rankings || [])) curRank[t.teamId] = t.rank;

  histDelta = {};
  for (const [teamId, cur] of Object.entries(curRank)) {
    const prev = prevRank[teamId];
    if (prev != null) histDelta[teamId] = prev - cur; // positive = moved up
  }
}

function renderHistoricalRankings(entry) {
  const thead = document.getElementById('rankings-head');
  const tbody = document.getElementById('rankings-body');

  const systems = Object.keys(entry.systems || {});
  const sysHeaders = systems.map(id =>
    `<th class="cat-sys">${escapeHtml(entry.systems[id].name)}</th>`
  ).join('');
  const colCount = 3 + systems.length;

  // Replace table header with simplified historical columns
  thead.innerHTML = `
    <tr>
      <th style="width:44px">#</th>
      <th>Team</th>
      <th class="cat-sys">Score</th>
      ${sysHeaders}
    </tr>
  `;

  // Build system rank lookups: sysRank[sysId][teamId] = rank
  const sysRank = {};
  for (const [id, sys] of Object.entries(entry.systems)) {
    sysRank[id] = {};
    for (const t of (sys.rankings || [])) sysRank[id][t.teamId] = t.rank;
  }

  const rankings = (entry.consensus && entry.consensus.rankings) || [];
  const sorted = [...rankings].sort((a, b) => b.totalPoints - a.totalPoints);

  tbody.innerHTML = '';
  const total = sorted.length;
  sorted.forEach((team, i) => {
    const rank = i + 1;
    const badgeClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    const d = histDelta[team.teamId];
    const deltaHtml = d == null ? '' : d === 0
      ? '<span class="delta flat">\u2014</span>'
      : d > 0 ? `<span class="delta up">&#9650;${d}</span>`
               : `<span class="delta down">&#9660;${Math.abs(d)}</span>`;

    const rankCells = systems.map(id => {
      const r = sysRank[id] && sysRank[id][team.teamId];
      return r != null
        ? `<td class="cat-cell"><span style="color:${getRankColor(r, total)}">#${r}</span></td>`
        : `<td class="cat-cell"><span style="color:#555">\u2014</span></td>`;
    }).join('');

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="rank-badge ${badgeClass}">${rank}</span></td>
      <td><strong style="color:#fff">${escapeHtml(team.teamName)}</strong>${deltaHtml}</td>
      <td class="cat-cell"><span style="color:#e0e0e0;font-weight:700">${team.totalPoints.toFixed(1)}</span></td>
      ${rankCells}
    `;
    tbody.appendChild(row);
  });

  // Disable team detail click in history mode (full stat data not stored)
  tbody.querySelectorAll('tr').forEach(r => r.style.cursor = 'default');
}

function restoreLiveTableHead() {
  document.getElementById('rankings-head').innerHTML = LIVE_THEAD_HTML;
}

async function navigateHistory(idx) {
  histDateIdx = idx;
  updateHistoryNavUI();

  if (idx === -1) {
    // Return to live view
    restoreLiveTableHead();
    recomputeAndRender();
    return;
  }

  const entry = histPastEntries[idx];
  computeHistDelta(entry);
  renderHistoricalRankings(entry);
}

// ── Composite Rankings ──



function populateProviderDropdown() {
  const select = document.getElementById('projection-select');
  if (!select) return;
  select.innerHTML = '';
  const systems = (rankingsData && rankingsData.systems) || {};
  for (const [id, sys] of Object.entries(systems)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = sys.name;
    select.appendChild(opt);
  }
  if (rankingsData && rankingsData.consensus) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '──────────';
    select.appendChild(sep);
    const opt = document.createElement('option');
    opt.value = 'consensus';
    opt.textContent = 'Consensus (All Systems)';
    opt.selected = true;
    select.appendChild(opt);
  }
}

// ── Rankings history & delta ──

function computeLiveDelta() {
  if (!histPastEntries.length) return;
  const prev = [...histPastEntries].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!prev || !prev.consensus || !prev.consensus.rankings) return;

  const prevRank = {};
  for (const t of prev.consensus.rankings) prevRank[t.teamId] = t.rank;

  const deltas = {};
  currentRankings.forEach((t, i) => {
    const yRank = prevRank[t.teamId];
    if (yRank != null) deltas[t.teamId] = yRank - (i + 1);
  });
  rankingsDelta = deltas;
}

function setDataTimestamp(isoString) {
  const el = document.getElementById('last-updated');
  if (!el) return;
  if (isoString) {
    el.textContent = 'Data updated: ' + new Date(isoString).toLocaleString();
  } else {
    el.textContent = 'Data updated: unknown';
  }
  checkDataStaleness(isoString);
}

function checkDataStaleness(isoString) {
  const banner = document.getElementById('staleness-banner');
  if (!banner) return;
  if (!isoString) {
    banner.style.display = 'none';
    return;
  }
  const ageMs = Date.now() - new Date(isoString).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours > 24) {
    const days = Math.floor(ageHours / 24);
    banner.textContent = 'Data is ' + days + ' day' + (days > 1 ? 's' : '') +
      ' old. Projection data may be outdated.';
    banner.className = 'staleness-banner' + (ageHours > 72 ? ' error' : '');
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }
}

function switchProvider(systemId) {
  setCurrentSystem(systemId);
  recomputeAndRender();
}

async function init() {
  try {
    const [rankResp, histResp] = await Promise.all([
      fetch('data/power_rankings.json'),
      fetch('data/power_rankings_history.json'),
    ]);

    if (!rankResp.ok) throw new Error('power_rankings.json not found. Run: node scripts/refresh-data.js --skip-api');
    rankingsData = await rankResp.json();
    liveServerDate = rankingsData.serverDate || null;

    if (histResp.ok) {
      historyData = await histResp.json();
      const today = liveServerDate || localDateKey();
      histPastEntries = (historyData.entries || []).filter(e => e.date < today);
    }

    populateProviderDropdown();

    const defaultSystem = rankingsData.consensus ? 'consensus' : rankingsData.primarySystem;
    setCurrentSystem(defaultSystem);

    computeLiveDelta();
    recomputeAndRender();
    setDataTimestamp(rankingsData.generatedAt);
    buildHistoryNav();

    const projSelect = document.getElementById('projection-select');
    if (projSelect) {
      projSelect.addEventListener('change', e => switchProvider(e.target.value));
    }
  } catch (err) {
    console.error('Failed to load power rankings:', err);
    document.getElementById('rankings-body').innerHTML =
      '<tr><td colspan="12" style="text-align:center;padding:32px;color:#ef4444;">Error loading data: ' + escapeHtml(err.message) + '</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', init);
