/*
 * Projection Provider Registry — Strategy Pattern
 *
 * Each provider defines how to load, parse, and extract stats from a
 * projection source.  
 *
 * Shared modules loaded via <script> tags before this file:
 *   shared/categories.js — CATEGORIES, TEAM_ABBR_MAP, PROJECTION_SYSTEMS
 *
 * Interface contract every provider must satisfy:
 *   id             : string   — unique key (e.g. 'steamer')
 *   name           : string   — display name
 *   battingFile    : string   — fetch path for batting projections
 *   pitchingFile   : string   — fetch path for pitching projections
 *   fangraphsType  : string?  — FanGraphs API type param (if applicable)
 *   getPlayerName(row)           → string
 *   getTeam(row)                 → string (FanGraphs-style abbreviation)
 *   extractBatting(projRow)      → { HR, RBI, TB, H, BB, HBP, SF, PA, AB,
 *                                     SB, CS, OPS, SBN }
 *   extractPitching(projRow)     → { IP, K, ER, H, BB, W, QS, SV, HLD,
 *                                     ERA, WHIP, WQS, SVH, GS, G }
 *   isReliever(pitchingStats, playerInfo) → boolean
 */

const ProjectionRegistry = {
  _providers: {},

  register(provider) {
    this._providers[provider.id] = provider;
  },

  get(id) {
    return this._providers[id] || null;
  },

  list() {
    return Object.values(this._providers);
  },

  defaultId: 'steamer',
};

// ── FanGraphs provider factory ──────────────────────────────────────────────
// All FanGraphs projection systems share the same field layout; only the
// data source (file paths / API type parameter) differs.

function createFanGraphsProvider({ id, name, fangraphsType }) {
  return {
    id,
    name,
    battingFile:  'data/' + id + '_batting.json',
    pitchingFile: 'data/' + id + '_pitching.json',
    fangraphsType,

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

// ── Built-in providers — auto-registered from shared PROJECTION_SYSTEMS ─────

for (const sys of KeeperShared.PROJECTION_SYSTEMS) {
  ProjectionRegistry.register(createFanGraphsProvider(sys));
}
