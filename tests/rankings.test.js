'use strict';

const { rankTeams, hitterValue, pitcherValue, normalizedValue } = require('../server/rankings');
const { CATEGORIES } = require('../shared/categories');

// ── Helpers ──────────────────────────────────────────────────────────────────

let _teamId = 0;
function makeTeam(stats) {
  return { teamId: `t${++_teamId}`, teamName: 'Test', stats, catRanks: {} };
}

const FULL_STATS = {
  HR: 25, RBI: 90, TB: 230, OPS: 0.780, SBN: 10,
  K: 140, ERA: 3.80, WHIP: 1.25, WQS: 20, SVH: 25,
};

// ── rankTeams ─────────────────────────────────────────────────────────────────

describe('rankTeams', () => {
  test('assigns totalPoints to every team', () => {
    const teams = [
      makeTeam({ ...FULL_STATS }),
      makeTeam({ ...FULL_STATS, HR: 15, ERA: 4.50 }),
    ];
    rankTeams(teams);
    for (const t of teams) {
      expect(typeof t.totalPoints).toBe('number');
      expect(Number.isFinite(t.totalPoints)).toBe(true);
    }
  });

  test('assigns catRanks for every category', () => {
    const teams = [makeTeam({ ...FULL_STATS }), makeTeam({ ...FULL_STATS, HR: 10 })];
    rankTeams(teams);
    for (const t of teams) {
      for (const cat of CATEGORIES) {
        expect(t.catRanks[cat.key]).toBeDefined();
        expect(typeof t.catRanks[cat.key].rank).toBe('number');
        expect(typeof t.catRanks[cat.key].points).toBe('number');
      }
    }
  });

  test('better team earns more total points', () => {
    const strong = makeTeam({ HR: 40, RBI: 120, TB: 300, OPS: 0.900, SBN: 20, K: 200, ERA: 2.90, WHIP: 1.05, WQS: 32, SVH: 40 });
    const weak   = makeTeam({ HR: 8,  RBI: 50,  TB: 140, OPS: 0.640, SBN: 2,  K: 75,  ERA: 5.60, WHIP: 1.65, WQS: 7,  SVH: 5  });
    rankTeams([strong, weak]);
    expect(strong.totalPoints).toBeGreaterThan(weak.totalPoints);
  });

  test('ERA — lower is better: lower ERA earns more points', () => {
    const good = makeTeam({ ...FULL_STATS, ERA: 2.80 });
    const bad  = makeTeam({ ...FULL_STATS, ERA: 5.50 });
    rankTeams([good, bad]);
    expect(good.catRanks['ERA'].points).toBeGreaterThan(bad.catRanks['ERA'].points);
  });

  test('WHIP — lower is better: lower WHIP earns more points', () => {
    const good = makeTeam({ ...FULL_STATS, WHIP: 1.00 });
    const bad  = makeTeam({ ...FULL_STATS, WHIP: 1.70 });
    rankTeams([good, bad]);
    expect(good.catRanks['WHIP'].points).toBeGreaterThan(bad.catRanks['WHIP'].points);
  });

  test('tied teams share average roto points', () => {
    const t1 = makeTeam({ ...FULL_STATS });
    const t2 = makeTeam({ ...FULL_STATS }); // exact duplicate stats
    rankTeams([t1, t2]);
    // Ranks 1 and 2 share the average: (2 + 1) / 2 = 1.5 for each category
    expect(t1.catRanks['HR'].points).toBe(1.5);
    expect(t2.catRanks['HR'].points).toBe(1.5);
  });

  test('category points across all teams sum to n*(n+1)/2', () => {
    const teams = [
      makeTeam({ HR: 30, RBI: 100, TB: 250, OPS: 0.820, SBN: 12, K: 160, ERA: 3.20, WHIP: 1.15, WQS: 24, SVH: 30 }),
      makeTeam({ HR: 20, RBI: 80,  TB: 200, OPS: 0.760, SBN: 7,  K: 130, ERA: 3.90, WHIP: 1.28, WQS: 18, SVH: 18 }),
      makeTeam({ HR: 10, RBI: 60,  TB: 170, OPS: 0.700, SBN: 3,  K: 95,  ERA: 4.60, WHIP: 1.48, WQS: 11, SVH: 8  }),
    ];
    rankTeams(teams);
    const n = teams.length;
    const expected = (n * (n + 1)) / 2;
    for (const cat of CATEGORIES) {
      const total = teams.reduce((s, t) => s + t.catRanks[cat.key].points, 0);
      expect(total).toBeCloseTo(expected);
    }
  });
});

// ── hitterValue (no-pool fallback) ────────────────────────────────────────────

describe('hitterValue (fallback, no pool)', () => {
  test('returns a finite number', () => {
    const s = { HR: 20, RBI: 80, TB: 200, OPS: 0.750, SBN: 10, PA: 550 };
    expect(Number.isFinite(hitterValue(s, null))).toBe(true);
  });

  test('more HR → higher value', () => {
    const base = { HR: 20, RBI: 80, TB: 200, OPS: 0.750, SBN: 10, PA: 550 };
    expect(hitterValue({ ...base, HR: 35 }, null)).toBeGreaterThan(hitterValue(base, null));
  });

  test('higher OPS → higher value', () => {
    const base = { HR: 20, RBI: 80, TB: 200, OPS: 0.750, SBN: 10, PA: 550 };
    expect(hitterValue({ ...base, OPS: 0.950 }, null)).toBeGreaterThan(hitterValue(base, null));
  });
});

// ── pitcherValue (no-pool fallback) ───────────────────────────────────────────

describe('pitcherValue (fallback, no pool)', () => {
  test('returns a finite number', () => {
    const s = { K: 150, WQS: 20, SVH: 30, IP: 180, ERA: 3.50, WHIP: 1.20 };
    expect(Number.isFinite(pitcherValue(s, null))).toBe(true);
  });

  test('more strikeouts → higher value', () => {
    const base = { K: 150, WQS: 20, SVH: 30, IP: 180, ERA: 3.50, WHIP: 1.20 };
    expect(pitcherValue({ ...base, K: 220 }, null)).toBeGreaterThan(pitcherValue(base, null));
  });
});

// ── normalizedValue ───────────────────────────────────────────────────────────

describe('normalizedValue', () => {
  const catConfig = [
    { key: 'HR',  higher: true  },
    { key: 'ERA', higher: false },
  ];

  test('best player in pool scores highest', () => {
    const pool = [
      { HR: 40, ERA: 3.0 },
      { HR: 20, ERA: 4.0 },
      { HR: 10, ERA: 5.0 },
    ];
    const best  = normalizedValue(pool[0], pool, ['HR', 'ERA'], catConfig);
    const worst = normalizedValue(pool[2], pool, ['HR', 'ERA'], catConfig);
    expect(best).toBeGreaterThan(worst);
  });

  test('scores are in [0, n] range where n = number of cats', () => {
    const pool = [
      { HR: 40, ERA: 3.0 },
      { HR: 10, ERA: 5.0 },
    ];
    const score = normalizedValue(pool[0], pool, ['HR', 'ERA'], catConfig);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(2); // 2 categories max
  });

  test('returns 0 when all pool values are equal (no range to normalize)', () => {
    const pool = [{ HR: 20, ERA: 4.0 }, { HR: 20, ERA: 4.0 }];
    expect(normalizedValue(pool[0], pool, ['HR', 'ERA'], catConfig)).toBe(0);
  });

  test('lower ERA is better — lower-ERA player scores higher', () => {
    const pool = [{ HR: 20, ERA: 3.0 }, { HR: 20, ERA: 5.0 }];
    const good = normalizedValue(pool[0], pool, ['HR', 'ERA'], catConfig);
    const bad  = normalizedValue(pool[1], pool, ['HR', 'ERA'], catConfig);
    expect(good).toBeGreaterThan(bad);
  });
});
