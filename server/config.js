const path = require('path');

// Load .env from project root before anything else
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  leagueId: process.env.FANTRAX_LEAGUE_ID,
  fantraxCookie: process.env.FANTRAX_COOKIE || '',
  port: parseInt(process.env.PORT, 10) || 3000,

  schedules: {
    rosters:     process.env.CRON_ROSTERS     || '*/15 * * * *',
    standings:   process.env.CRON_STANDINGS    || '*/30 * * * *',
    projections: process.env.CRON_PROJECTIONS  || '0 0,12 * * *',
    draft:       process.env.CRON_DRAFT        || '0 * * * *',
    adp:         process.env.CRON_ADP          || '0 6 * * *',
    playerStats: process.env.CRON_PLAYER_STATS || '*/30 * * * *',
  },

  projectionTypes: (process.env.PROJECTION_TYPES || 'steamer,zips,atc,thebat,thebatx,dc')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  dataDir: path.join(__dirname, '..', 'data'),
};

if (!config.leagueId) {
  console.error('Error: FANTRAX_LEAGUE_ID is required.');
  console.error('Copy .env.example to .env and set your league ID.');
  process.exit(1);
}

module.exports = config;
