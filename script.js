async function loadData() {
  const [rostersResp, playersResp] = await Promise.all([
    fetch('data/fantrax_rosters.json'),
    fetch('data/fantrax_players.json')
  ]);
  const rosters = await rostersResp.json();
  const players = await playersResp.json();
  return { rosters, players };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function render(rosters, players, teamFilter, posFilter, statusFilter, search) {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  let totalPlayers = 0;
  const searchLower = search.toLowerCase();

  // Position order for traditional baseball
  const positionOrder = { C: 0, '1B': 1, '2B': 2, '3B': 3, SS: 4, OF: 5, P: 6, DH: 7, UT: 8 };

  for (const [teamId, teamData] of Object.entries(rosters.rosters)) {
    if (teamFilter && teamId !== teamFilter) continue;

    const active = [];
    const reserve = [];

    for (const item of teamData.rosterItems) {
      const pinfo = players[item.id] || {};
      const name = pinfo.name || `Unknown (${item.id})`;
      const mlbTeam = pinfo.team || '?';

      if (posFilter && item.position !== posFilter) continue;
      if (statusFilter && item.status !== statusFilter) continue;
      if (searchLower && !name.toLowerCase().includes(searchLower)) continue;

      const row = { id: item.id, name, mlbTeam, position: item.position, status: item.status };
      if (item.status === 'ACTIVE') active.push(row);
      else reserve.push(row);
    }

    // Sort active and reserve by position order
    active.sort((a, b) => (positionOrder[a.position] || 999) - (positionOrder[b.position] || 999));
    reserve.sort((a, b) => (positionOrder[a.position] || 999) - (positionOrder[b.position] || 999));

    const all = [...active, ...reserve];
    if (all.length === 0) continue;

    totalPlayers += all.length;

    const card = document.createElement('div');
    card.className = 'team-card';

    card.innerHTML = `
      <div class="team-header">
        <div class="team-name">${escapeHtml(teamData.teamName)}</div>
        <div class="team-count">${all.length} players</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Pos</th>
            <th>Player</th>
            <th>MLB</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="tbody-${teamId}"></tbody>
      </table>
    `;

    grid.appendChild(card);

    const tbody = card.querySelector(`#tbody-${teamId}`);

    function addRows(rows, isReserve) {
      if (rows.length === 0) return;
      if (isReserve && active.length > 0) {
        const divRow = document.createElement('tr');
        divRow.innerHTML = `<td colspan="4" class="section-divider">Reserve</td>`;
        tbody.appendChild(divRow);
      }
      for (const p of rows) {
        const tr = document.createElement('tr');
        if (isReserve) tr.classList.add('reserve');
        tr.innerHTML = `
          <td><span class="pos-badge ${escapeHtml(p.position)}">${escapeHtml(p.position)}</span></td>
          <td class="player-name ${isReserve ? 'reserve-label' : ''}">${escapeHtml(p.name)}</td>
          <td class="mlb-team">${escapeHtml(p.mlbTeam)}</td>
          <td><span class="status-badge ${escapeHtml(p.status)}">${escapeHtml(p.status)}</span></td>
        `;
        tbody.appendChild(tr);
      }
    }

    addRows(active, false);
    addRows(reserve, true);
  }

  document.getElementById('total-count').textContent = totalPlayers;

  if (grid.children.length === 0) {
    grid.innerHTML = '<div id="loading" style="color:#555">No matching players found.</div>';
  }
}

(async () => {
  try {
    const { rosters, players } = await loadData();

    document.getElementById('period-label').textContent = `Period ${rosters.period}`;

    const teamSelect = document.getElementById('team-filter');
    for (const [id, data] of Object.entries(rosters.rosters)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = data.teamName;
      teamSelect.appendChild(opt);
    }

    function rerender() {
      render(
        rosters, players,
        document.getElementById('team-filter').value,
        document.getElementById('pos-filter').value,
        document.getElementById('status-filter').value,
        document.getElementById('search').value
      );
    }

    document.getElementById('team-filter').addEventListener('change', rerender);
    document.getElementById('pos-filter').addEventListener('change', rerender);
    document.getElementById('status-filter').addEventListener('change', rerender);
    document.getElementById('search').addEventListener('input', rerender);

    rerender();
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    const errDiv = document.getElementById('error-msg');
    errDiv.style.display = 'block';
    errDiv.textContent = `Failed to load data: ${err.message}. Make sure to serve this file with a local web server (e.g. "python3 -m http.server 8080").`;
  }
})();
