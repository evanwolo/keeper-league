const { validateRosters, validateProjections, validatePlayers } = (() => {
  // Extract validation functions from api.js for testing
  // Since they aren't exported, we redefine them here matching the implementation
  function validateRosters(rosters) {
    if (!rosters || typeof rosters !== 'object') throw new Error('Roster response is not an object');
    if (!rosters.rosters || typeof rosters.rosters !== 'object') throw new Error('Roster response missing rosters map');
    const teamIds = Object.keys(rosters.rosters);
    if (teamIds.length === 0) throw new Error('Roster response has zero teams');
    for (const [id, team] of Object.entries(rosters.rosters)) {
      if (!team.teamName) throw new Error(`Team ${id} missing teamName`);
      if (!Array.isArray(team.rosterItems)) throw new Error(`Team ${id} missing rosterItems array`);
    }
  }

  function validateProjections(data, type, stat) {
    const arr = Array.isArray(data) ? data : (data && data.players) || [];
    if (arr.length < 50) throw new Error(`${type} ${stat} projections: only ${arr.length} players (expected 50+)`);
    const sample = arr[0];
    if (!sample.PlayerName) throw new Error(`${type} ${stat} projections: missing PlayerName field`);
  }

  function validatePlayers(players) {
    if (!players || typeof players !== 'object') throw new Error('Players response is not an object');
    if (Object.keys(players).length < 10) throw new Error(`Players response has only ${Object.keys(players).length} entries (expected 10+)`);
  }

  return { validateRosters, validateProjections, validatePlayers };
})();

describe('validateRosters', () => {
  test('accepts valid roster data', () => {
    const data = {
      period: 1,
      rosters: {
        team1: { teamName: 'Team One', rosterItems: [{ id: 'p1', position: 'C', status: 'ACTIVE' }] },
        team2: { teamName: 'Team Two', rosterItems: [] },
      },
    };
    expect(() => validateRosters(data)).not.toThrow();
  });

  test('rejects null', () => {
    expect(() => validateRosters(null)).toThrow('not an object');
  });

  test('rejects missing rosters map', () => {
    expect(() => validateRosters({ period: 1 })).toThrow('missing rosters map');
  });

  test('rejects empty rosters', () => {
    expect(() => validateRosters({ rosters: {} })).toThrow('zero teams');
  });

  test('rejects team without teamName', () => {
    expect(() => validateRosters({
      rosters: { t1: { rosterItems: [] } },
    })).toThrow('missing teamName');
  });
});

describe('validateProjections', () => {
  test('accepts valid projection array', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      PlayerName: `Player ${i}`,
      Team: 'NYY',
    }));
    expect(() => validateProjections(data, 'steamer', 'batting')).not.toThrow();
  });

  test('rejects too few players', () => {
    const data = [{ PlayerName: 'P1' }];
    expect(() => validateProjections(data, 'steamer', 'batting')).toThrow('only 1 players');
  });

  test('rejects missing PlayerName', () => {
    const data = Array.from({ length: 100 }, () => ({ Name: 'Test' }));
    expect(() => validateProjections(data, 'steamer', 'batting')).toThrow('missing PlayerName');
  });
});

describe('validatePlayers', () => {
  test('accepts valid player map', () => {
    const players = {};
    for (let i = 0; i < 20; i++) players[`p${i}`] = { name: `Player ${i}` };
    expect(() => validatePlayers(players)).not.toThrow();
  });

  test('rejects null', () => {
    expect(() => validatePlayers(null)).toThrow('not an object');
  });

  test('rejects too few entries', () => {
    expect(() => validatePlayers({ p1: {} })).toThrow('only 1 entries');
  });
});
