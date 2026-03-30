const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const scheduler = require('./scheduler');

const ROOT = path.resolve(__dirname, '..');

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
  res.writeHead(code, { 'Content-Type': 'application/json' });
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
      // JSON data files: no cache so the frontend always gets fresh data
      'Cache-Control': ext === '.json' ? 'no-cache' : 'public, max-age=300',
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
