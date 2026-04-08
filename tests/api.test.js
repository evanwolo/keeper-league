'use strict';

const { normalizeStatKey, normalizeStatsObject } = require('../data/api');

// ── normalizeStatKey ──────────────────────────────────────────────────────────

describe('normalizeStatKey', () => {
  test('maps exact category keys', () => {
    expect(normalizeStatKey('HR')).toBe('HR');
    expect(normalizeStatKey('ERA')).toBe('ERA');
    expect(normalizeStatKey('WHIP')).toBe('WHIP');
    expect(normalizeStatKey('K')).toBe('K');
    expect(normalizeStatKey('SV')).toBe('SV');
  });

  test('maps common aliases case-insensitively', () => {
    expect(normalizeStatKey('StrikeOuts')).toBe('K');
    expect(normalizeStatKey('homeruns')).toBe('HR');
    expect(normalizeStatKey('QUALITYSTARTS')).toBe('QS');
    expect(normalizeStatKey('holds')).toBe('HLD');
    expect(normalizeStatKey('Saves')).toBe('SV');
    expect(normalizeStatKey('RUNSBATTEDIN')).toBe('RBI');
    expect(normalizeStatKey('TOTALBASES')).toBe('TB');
    expect(normalizeStatKey('STOLENBASES')).toBe('SB');
    expect(normalizeStatKey('CAUGHTSTEALING')).toBe('CS');
  });

  test('SO maps to K (strikeout alias used by some sources)', () => {
    expect(normalizeStatKey('SO')).toBe('K');
  });

  test('returns null for unknown keys', () => {
    expect(normalizeStatKey('NOTASTAT')).toBeNull();
    expect(normalizeStatKey('XYZ')).toBeNull();
  });

  test('returns null for empty or nullish input', () => {
    expect(normalizeStatKey('')).toBeNull();
    expect(normalizeStatKey(null)).toBeNull();
    expect(normalizeStatKey(undefined)).toBeNull();
  });

  test('strips non-alphanumeric characters before lookup', () => {
    // e.g. "W/L" or "W+QS" should not match, but "WQS" should
    expect(normalizeStatKey('WQS')).toBe('WQS');
    expect(normalizeStatKey('SVH')).toBe('SVH');
  });
});

// ── normalizeStatsObject ──────────────────────────────────────────────────────

describe('normalizeStatsObject', () => {
  test('returns null for non-object input', () => {
    expect(normalizeStatsObject(null)).toBeNull();
    expect(normalizeStatsObject(undefined)).toBeNull();
    expect(normalizeStatsObject(42)).toBeNull();
    expect(normalizeStatsObject('string')).toBeNull();
  });

  test('returns null when fewer than 3 recognisable stats are present', () => {
    expect(normalizeStatsObject({ HR: 10, RBI: 80 })).toBeNull();
    expect(normalizeStatsObject({})).toBeNull();
  });

  test('maps known stat keys and coerces string numbers', () => {
    const result = normalizeStatsObject({ HR: '25', RBI: '90', K: '150', ERA: '3.50' });
    expect(result).not.toBeNull();
    expect(result.HR).toBe(25);
    expect(result.RBI).toBe(90);
    expect(result.K).toBe(150);
    expect(result.ERA).toBeCloseTo(3.50);
  });

  test('drops non-numeric values (returns undefined for bad entries)', () => {
    // 'abc' is not a valid number — should be ignored
    const result = normalizeStatsObject({ HR: 'abc', RBI: 80, K: 120, ERA: 4.0 });
    expect(result).not.toBeNull();
    expect(result.HR).toBeUndefined();
    expect(result.RBI).toBe(80);
  });

  test('ignores unrecognised stat key names', () => {
    const result = normalizeStatsObject({ HR: 10, RBI: 80, SB: 15, NOTASTAT: 99 });
    expect(result).not.toBeNull();
    expect(result.NOTASTAT).toBeUndefined();
  });

  test('derives SBN from SB and CS when SBN is absent', () => {
    const result = normalizeStatsObject({ HR: 10, RBI: 50, SB: 20, CS: 5 });
    expect(result.SBN).toBeCloseTo(15.0);
  });

  test('does not overwrite explicit SBN', () => {
    const result = normalizeStatsObject({ HR: 10, RBI: 50, SB: 20, CS: 5, SBN: 99 });
    expect(result.SBN).toBe(99);
  });

  test('derives WQS from W and QS when WQS is absent', () => {
    const result = normalizeStatsObject({ HR: 10, RBI: 50, W: 12, QS: 18 });
    expect(result.WQS).toBeCloseTo(30.0);
  });

  test('derives SVH from SV and HLD when SVH is absent', () => {
    const result = normalizeStatsObject({ HR: 10, RBI: 50, SV: 15, HLD: 20 });
    expect(result.SVH).toBeCloseTo(35.0);
  });

  test('handles alias keys in input (e.g. HOLDS instead of HLD)', () => {
    const result = normalizeStatsObject({ HR: 10, RBI: 80, HOLDS: 15, SAVES: 10, K: 130 });
    expect(result.HLD).toBe(15);
    expect(result.SV).toBe(10);
  });
});
