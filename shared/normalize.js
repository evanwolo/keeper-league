/**
 * Shared name normalization & projection lookup utilities.
 * Works as both a browser <script> (requires shared/categories.js first) and Node.js require().
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./categories'));
  } else {
    root.KeeperShared = root.KeeperShared || {};
    Object.assign(root.KeeperShared, factory(root.KeeperShared));
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (shared) {
  'use strict';

  var TEAM_ABBR_MAP = shared.TEAM_ABBR_MAP;

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
    var cleaned = fantraxName.replace(/-[A-Z]\b/g, '');
    var parts = cleaned.split(',').map(function (s) { return s.trim(); });
    if (parts.length >= 2) return normalizeName(parts[1] + ' ' + parts[0]);
    return normalizeName(cleaned);
  }

  function buildProjectionLookup(data, provider) {
    var arr = Array.isArray(data) ? data : (data.players || []);
    var byName = {};
    for (var i = 0; i < arr.length; i++) {
      var key = normalizeName(provider.getPlayerName(arr[i]));
      if (!byName[key]) byName[key] = [];
      byName[key].push(arr[i]);
    }
    return byName;
  }

  function findProjection(fantraxPlayer, lookup, provider) {
    var key = fantraxNameToNormal(fantraxPlayer.name);
    var candidates = lookup[key];
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    var fgTeam = TEAM_ABBR_MAP[fantraxPlayer.team] || fantraxPlayer.team;
    return candidates.find(function (c) { return provider.getTeam(c) === fgTeam; }) || candidates[0];
  }

  return {
    normalizeName: normalizeName,
    fantraxNameToNormal: fantraxNameToNormal,
    buildProjectionLookup: buildProjectionLookup,
    findProjection: findProjection,
  };
}));
