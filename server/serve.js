const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const scheduler = require('./scheduler');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = process.env.API_TOKEN || '';

if (!API_TOKEN) {
  console.warn('Warning: API_TOKEN is not set — /api/refresh endpoints are unprotected. Set API_TOKEN in .env to require auth.');
}

// ── Rate limiting ───────────────────────────────────────────────────────────

const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_MAX = 5; // max refresh requests per window
const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_MAX;
}

// Clean up stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS * 2;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.windowStart < cutoff) rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000).unref();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// Paths that must never be served to clients
const BLOCKED = new Set(['server', 'node_modules', '.env', '.git', '.gitignore']);

function sendJSON(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data, null, 2));
}

// ── Static file handler ─────────────────────────────────────────────────────

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const relative = urlPath.replace(/^\/+/, '');
  const firstSegment = relative.split(/[/\\]/)[0];

  if (BLOCKED.has(firstSegment) || relative.startsWith('.')) {
    sendJSON(res, 403, { error: 'Forbidden' });
    return;
  }

  const filePath = path.resolve(ROOT, relative);

  // Directory-traversal guard
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    sendJSON(res, 403, { error: 'Forbidden' });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJSON(res, 404, { error: 'Not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      // JSON and JS files: no cache so the frontend always gets fresh data
      'Cache-Control': (ext === '.json' || ext === '.js') ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'",
    });
    res.end(data);
  });
}

// ── API endpoints ───────────────────────────────────────────────────────────

function handleAPI(req, res) {
  const url = req.url.split('?')[0];

  // GET /api/status — health check & job info
  if (url === '/api/status') {
    const dataFiles = {};
    try {
      for (const f of fs.readdirSync(config.dataDir)) {
        if (f.endsWith('.json')) {
          const stat = fs.statSync(path.join(config.dataDir, f));
          dataFiles[f] = { size: stat.size, modified: stat.mtime.toISOString() };
        }
      }
    } catch { /* data dir may not exist yet */ }

    sendJSON(res, 200, {
      uptime: Math.round(process.uptime()),
      leagueId: config.leagueId,
      schedules: config.schedules,
      projectionTypes: config.projectionTypes,
      jobs: scheduler.getStatus(),
      dataFiles,
    });
    return;
  }

  // POST/GET /api/refresh[/jobName] — manually trigger a data refresh
  if (url.startsWith('/api/refresh')) {
    // Auth check: if API_TOKEN is configured, require it
    if (API_TOKEN) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (token !== API_TOKEN) {
        sendJSON(res, 401, { error: 'Unauthorized — set Authorization: Bearer <API_TOKEN>' });
        return;
      }
    }

    // Rate limit
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      sendJSON(res, 429, { error: 'Too many requests. Try again in 1 minute.' });
      return;
    }

    const parts = url.split('/').filter(Boolean); // ['api', 'refresh', 'rosters']
    const jobName = parts[2];

    if (!jobName) {
      scheduler.runAll().catch(err => console.error('Full refresh error:', err.message));
      sendJSON(res, 200, { message: 'Full refresh triggered' });
      return;
    }

    if (scheduler.jobs[jobName]) {
      scheduler.jobs[jobName]().catch(err => console.error(`Refresh error (${jobName}):`, err.message));
      sendJSON(res, 200, { message: `Refresh triggered: ${jobName}` });
      return;
    }

    sendJSON(res, 404, {
      error: `Unknown job: ${jobName}`,
      available: Object.keys(scheduler.jobs),
    });
    return;
  }

  sendJSON(res, 404, { error: 'Unknown endpoint' });
}

// ── Server start ────────────────────────────────────────────────────────────

function start() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      handleAPI(req, res);
    } else {
      serveStatic(req, res);
    }
  });

  server.listen(config.port, () => {
    console.log(`HTTP server:  http://localhost:${config.port}`);
    console.log(`  Frontend:   http://localhost:${config.port}/`);
    console.log(`  Status:     http://localhost:${config.port}/api/status`);
    console.log(`  Refresh:    http://localhost:${config.port}/api/refresh`);
    console.log(`  Refresh job http://localhost:${config.port}/api/refresh/{rosters|standings|projections|draft|adp}`);
  });

  return server;
}

module.exports = { start };
