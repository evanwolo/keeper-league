const { CATEGORIES, TEAM_ABBR_MAP, PROJECTION_SYSTEMS } = require('../shared/categories');

describe('shared/categories', () => {
  test('CATEGORIES has 10 entries', () => {
    expect(CATEGORIES).toHaveLength(10);
  });

  test('CATEGORIES has 5 hitting and 5 pitching', () => {
    const hitting = CATEGORIES.filter(c => c.type === 'hitting');
    const pitching = CATEGORIES.filter(c => c.type === 'pitching');
    expect(hitting).toHaveLength(5);
    expect(pitching).toHaveLength(5);
  });

  test('every category has required fields', () => {
    for (const cat of CATEGORIES) {
      expect(cat).toHaveProperty('key');
      expect(cat).toHaveProperty('label');
      expect(cat).toHaveProperty('type');
      expect(typeof cat.higher).toBe('boolean');
    }
  });

  test('ERA and WHIP are lower-is-better', () => {
    const era = CATEGORIES.find(c => c.key === 'ERA');
    const whip = CATEGORIES.find(c => c.key === 'WHIP');
    expect(era.higher).toBe(false);
    expect(whip.higher).toBe(false);
  });

  test('TEAM_ABBR_MAP maps common Fantrax abbreviations', () => {
    expect(TEAM_ABBR_MAP.KC).toBe('KCR');
    expect(TEAM_ABBR_MAP.TB).toBe('TBR');
    expect(TEAM_ABBR_MAP.SD).toBe('SDP');
    expect(TEAM_ABBR_MAP.SF).toBe('SFG');
    expect(TEAM_ABBR_MAP.WAS).toBe('WSN');
  });

  test('PROJECTION_SYSTEMS has 6 systems', () => {
    expect(PROJECTION_SYSTEMS).toHaveLength(6);
  });

  test('every projection system has id, name, fangraphsType', () => {
    for (const sys of PROJECTION_SYSTEMS) {
      expect(sys).toHaveProperty('id');
      expect(sys).toHaveProperty('name');
      expect(sys).toHaveProperty('fangraphsType');
      expect(typeof sys.id).toBe('string');
      expect(typeof sys.name).toBe('string');
      expect(typeof sys.fangraphsType).toBe('string');
    }
  });

  test('dc system maps to fangraphsdc', () => {
    const dc = PROJECTION_SYSTEMS.find(s => s.id === 'dc');
    expect(dc.fangraphsType).toBe('fangraphsdc');
  });
});
