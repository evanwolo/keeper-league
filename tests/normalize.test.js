const { normalizeName, fantraxNameToNormal, buildProjectionLookup, findProjection } = require('../shared/normalize');

describe('normalizeName', () => {
  test('lowercases and strips accents', () => {
    expect(normalizeName('José Ramírez')).toBe('jose ramirez');
  });

  test('strips Jr suffix', () => {
    expect(normalizeName('Fernando Tatis Jr.')).toBe('fernando tatis');
    expect(normalizeName('Vladimir Guerrero Jr')).toBe('vladimir guerrero');
  });

  test('strips Sr suffix', () => {
    expect(normalizeName('Ken Griffey Sr.')).toBe('ken griffey');
  });

  test('strips roman numerals', () => {
    expect(normalizeName('Bobby Bradley III')).toBe('bobby bradley');
    expect(normalizeName('John Smith II')).toBe('john smith');
  });

  test('strips punctuation and collapses whitespace', () => {
    expect(normalizeName("De'Andre  Swift")).toBe('deandre swift');
  });

  test('handles empty string', () => {
    expect(normalizeName('')).toBe('');
  });
});

describe('fantraxNameToNormal', () => {
  test('converts Last, First format', () => {
    expect(fantraxNameToNormal('Ramirez, Jose')).toBe('jose ramirez');
  });

  test('strips two-way player suffix', () => {
    expect(fantraxNameToNormal('Ohtani-P, Shohei')).toBe('shohei ohtani');
    expect(fantraxNameToNormal('Ohtani-B, Shohei')).toBe('shohei ohtani');
  });

  test('handles single-name format', () => {
    expect(fantraxNameToNormal('Shohei Ohtani')).toBe('shohei ohtani');
  });

  test('handles accented names in Fantrax format', () => {
    expect(fantraxNameToNormal('Ramírez, José')).toBe('jose ramirez');
  });
});

describe('buildProjectionLookup', () => {
  const provider = {
    getPlayerName: (row) => row.PlayerName,
    getTeam: (row) => row.Team,
  };

  test('builds lookup from array data', () => {
    const data = [
      { PlayerName: 'José Ramírez', Team: 'CLE' },
      { PlayerName: 'Jose Ramirez', Team: 'NYY' },
    ];
    const lookup = buildProjectionLookup(data, provider);
    expect(lookup['jose ramirez']).toHaveLength(2);
  });

  test('builds lookup from object with players array', () => {
    const data = { players: [{ PlayerName: 'Mike Trout', Team: 'LAA' }] };
    const lookup = buildProjectionLookup(data, provider);
    expect(lookup['mike trout']).toHaveLength(1);
  });

  test('handles empty data', () => {
    const lookup = buildProjectionLookup([], provider);
    expect(Object.keys(lookup)).toHaveLength(0);
  });
});

describe('findProjection', () => {
  const provider = {
    getPlayerName: (row) => row.PlayerName,
    getTeam: (row) => row.Team,
  };

  test('finds exact match', () => {
    const data = [{ PlayerName: 'Mike Trout', Team: 'LAA' }];
    const lookup = buildProjectionLookup(data, provider);
    const result = findProjection({ name: 'Trout, Mike', team: 'LAA' }, lookup, provider);
    expect(result).toEqual({ PlayerName: 'Mike Trout', Team: 'LAA' });
  });

  test('disambiguates by team', () => {
    const data = [
      { PlayerName: 'Jose Ramirez', Team: 'CLE' },
      { PlayerName: 'Jose Ramirez', Team: 'NYY' },
    ];
    const lookup = buildProjectionLookup(data, provider);
    const result = findProjection({ name: 'Ramirez, Jose', team: 'CLE' }, lookup, provider);
    expect(result.Team).toBe('CLE');
  });

  test('maps Fantrax team abbreviations', () => {
    const data = [{ PlayerName: 'Wander Franco', Team: 'TBR' }];
    const lookup = buildProjectionLookup(data, provider);
    const result = findProjection({ name: 'Franco, Wander', team: 'TB' }, lookup, provider);
    expect(result).not.toBeNull();
  });

  test('returns null for unknown player', () => {
    const lookup = buildProjectionLookup([], provider);
    const result = findProjection({ name: 'Nobody, Test', team: 'NYY' }, lookup, provider);
    expect(result).toBeNull();
  });

  test('falls back to first candidate when team does not match', () => {
    const data = [
      { PlayerName: 'Jose Ramirez', Team: 'CLE' },
      { PlayerName: 'Jose Ramirez', Team: 'NYY' },
    ];
    const lookup = buildProjectionLookup(data, provider);
    const result = findProjection({ name: 'Ramirez, Jose', team: 'BOS' }, lookup, provider);
    expect(result.Team).toBe('CLE'); // first candidate
  });
});
