/**
 * Shared league configuration — categories, team mappings, projection systems.
 * Works as both a browser <script> and a Node.js require().
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KeeperShared = root.KeeperShared || {};
    Object.assign(root.KeeperShared, factory());
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CATEGORIES = [
    { key: 'HR',   label: 'HR',   type: 'hitting',  higher: true },
    { key: 'RBI',  label: 'RBI',  type: 'hitting',  higher: true },
    { key: 'TB',   label: 'TB',   type: 'hitting',  higher: true },
    { key: 'OPS',  label: 'OPS',  type: 'hitting',  higher: true },
    { key: 'SBN',  label: 'SBN',  type: 'hitting',  higher: true },
    { key: 'K',    label: 'K',    type: 'pitching', higher: true },
    { key: 'ERA',  label: 'ERA',  type: 'pitching', higher: false },
    { key: 'WHIP', label: 'WHIP', type: 'pitching', higher: false },
    { key: 'WQS',  label: 'W+QS', type: 'pitching', higher: true },
    { key: 'SVH',  label: 'SVH',  type: 'pitching', higher: true },
  ];

  var TEAM_ABBR_MAP = {
    KC: 'KCR', TB: 'TBR', SD: 'SDP', SF: 'SFG', WAS: 'WSN',
  };

  var PROJECTION_SYSTEMS = [
    { id: 'steamer',  name: 'Steamer',       fangraphsType: 'steamer' },
    { id: 'zips',     name: 'ZiPS',          fangraphsType: 'zips' },
    { id: 'atc',      name: 'ATC',           fangraphsType: 'atc' },
    { id: 'thebat',   name: 'THE BAT',       fangraphsType: 'thebat' },
    { id: 'thebatx',  name: 'THE BAT X',     fangraphsType: 'thebatx' },
    { id: 'dc',       name: 'Depth Charts',  fangraphsType: 'fangraphsdc' },
  ];

  return { CATEGORIES: CATEGORIES, TEAM_ABBR_MAP: TEAM_ABBR_MAP, PROJECTION_SYSTEMS: PROJECTION_SYSTEMS };
}));
