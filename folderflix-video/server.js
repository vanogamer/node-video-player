const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_FILE = path.join(__dirname, 'player-log.json');
const MAX_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

function nowIso() {
  return new Date().toISOString();
}

function baseLog() {
  const ts = nowIso();
  return {
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    lastWatched: null,
    lastDeleted: null,
    lastFolderRemoved: null,
    deleted: [],
    folderRemoved: []
  };
}

function readLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return baseLog();
    const parsed = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return {
      ...baseLog(),
      ...parsed,
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [],
      folderRemoved: Array.isArray(parsed.folderRemoved) ? parsed.folderRemoved : []
    };
  } catch (err) {
    console.error('Cannot read player-log.json:', err);
    return baseLog();
  }
}

function writeLog(log) {
  const base = baseLog();
  const normalized = {
    ...base,
    ...log,
    createdAt: log.createdAt || base.createdAt,
    updatedAt: nowIso(),
    deleted: Array.isArray(log.deleted) ? log.deleted.slice(0, 300) : [],
    folderRemoved: Array.isArray(log.folderRemoved) ? log.folderRemoved.slice(0, 100) : []
  };
  fs.writeFileSync(LOG_FILE, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const data = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

function safePathFromUrl(reqUrl) {
  const url = new URL(reqUrl, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const requested = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!requested.startsWith(PUBLIC_DIR)) return null;
  return requested;
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

function send405(res) {
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
}

function send500(res, err) {
  console.error(err);
  res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Server error');
}

function sendFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  const range = req.headers.range;

  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      res.writeHead(416, headers);
      res.end();
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      res.writeHead(416, {
        ...headers,
        'Content-Range': `bytes */${stat.size}`
      });
      res.end();
      return;
    }

    res.writeHead(206, {
      ...headers,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...headers,
    'Content-Length': stat.size
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/player-log' && req.method === 'GET') {
    return sendJson(res, 200, readLog());
  }

  if (url.pathname === '/api/player-log/last-watched' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const log = readLog();
    log.lastWatched = {
      ...body,
      savedAt: nowIso()
    };
    return sendJson(res, 200, { ok: true, log: writeLog(log) });
  }

  if (url.pathname === '/api/player-log/deleted' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const log = readLog();
    const deletedEntry = {
      ...body,
      deletedAt: nowIso()
    };
    log.lastDeleted = deletedEntry;
    log.deleted = [deletedEntry, ...(Array.isArray(log.deleted) ? log.deleted : [])].slice(0, 300);
    return sendJson(res, 200, { ok: true, log: writeLog(log) });
  }

  if (url.pathname === '/api/player-log/folder-removed' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const log = readLog();
    const removedEntry = {
      ...body,
      removedAt: nowIso()
    };
    log.lastFolderRemoved = removedEntry;
    log.folderRemoved = [removedEntry, ...(Array.isArray(log.folderRemoved) ? log.folderRemoved : [])].slice(0, 100);
    return sendJson(res, 200, { ok: true, log: writeLog(log) });
  }

  if (url.pathname === '/api/player-log/reset' && req.method === 'POST') {
    // After removing a folder from the playlist, old lastWatched/deleted state should not conflict with the next session.
    // Delete the JSON file physically; the next watch/delete action will recreate a clean JSON file automatically.
    try {
      if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    } catch (err) {
      console.error('Cannot delete player-log.json:', err);
      return sendJson(res, 500, { ok: false, error: 'Cannot delete player-log.json' });
    }
    return sendJson(res, 200, { ok: true, deletedJson: true, log: baseLog() });
  }

  return send404(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res).catch((err) => send500(res, err));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send405(res);

  const filePath = safePathFromUrl(req.url);
  if (!filePath) return send404(res);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send404(res);
    if (req.method === 'HEAD') {
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': stat.size
      });
      return res.end();
    }
    sendFile(req, res, filePath, stat);
  });
});

server.listen(PORT, () => {
  console.log('Video player is running:');
  console.log(`http://localhost:${PORT}`);
  console.log(`Log file: ${LOG_FILE}`);
});
