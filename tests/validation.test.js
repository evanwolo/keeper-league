const { validateRosters, validateProjections, validatePlayers } = require('../data/api');

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
