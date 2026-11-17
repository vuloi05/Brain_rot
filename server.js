const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 3456;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROGRESS_FILE = path.join(DATA_DIR, 'user-progress.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpge': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function createDefaultProgress() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      theme: 'hanshi',
      defaultLevel: 5,
      focusDurationMin: 15,
      requireDetoxGate: true,
      soundEnabled: false,
    },
    stats: {
      totalFocusSeconds: 0,
      completedSessions: 0,
      longestCleanSessionSec: 0,
      tabSwitchCount: 0,
      totalStrokesDrawn: 0,
      blindRecallSuccessCount: 0,
      blindRecallTotalCount: 0,
    },
    kanji: {},
    readingsDone: {},
    customReadings: [],
    sentencesDone: {},
    examNotes: {},
    sessionLogs: [],
  };
}

function ensureProgressFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROGRESS_FILE)) {
    const initial = createDefaultProgress();
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function readProgress() {
  ensureProgressFile();
  const raw = fs.readFileSync(PROGRESS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeProgress(data) {
  ensureProgressFile();
  const payload = {
    ...createDefaultProgress(),
    ...data,
    updatedAt: new Date().toISOString(),
  };
  const tmpPath = `${PROGRESS_FILE}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, PROGRESS_FILE);
  return payload;
}

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function readBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function runGit(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT_DIR, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        code: err ? err.code : 0,
      });
    });
  });
}

async function getGitStatus() {
  const gitDir = path.join(ROOT_DIR, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      isGitRepo: false,
      hasRemote: false,
      remoteUrl: '',
      branch: '',
      lastCommit: '',
      dirtyFiles: [],
      progressDirty: false,
    };
  }

  const [statusRes, branchRes, remoteRes, logRes] = await Promise.all([
    runGit(['status', '--porcelain']),
    runGit(['branch', '--show-current']),
    runGit(['remote', 'get-url', 'origin']),
    runGit(['log', '-1', '--format=%h · %s (%cr)']),
  ]);

  const dirtyFiles = statusRes.ok && statusRes.stdout
    ? statusRes.stdout.split(/\r?\n/).filter(Boolean)
    : [];

  return {
    isGitRepo: true,
    hasRemote: remoteRes.ok && Boolean(remoteRes.stdout),
    remoteUrl: remoteRes.ok ? remoteRes.stdout : '',
    branch: branchRes.ok ? branchRes.stdout : '',
    lastCommit: logRes.ok ? logRes.stdout : 'Chưa có commit',
    dirtyFiles,
    progressDirty: dirtyFiles.some((line) => line.includes('user-progress.json')),
  };
}

async function handleGitSave(doPush, commitMessage) {
  const status = await getGitStatus();
  if (!status.isGitRepo) {
    return {
      ok: false,
      error: 'Thư mục hiện tại chưa được khởi tạo Git (.git). Hãy chạy "git init" trước.',
    };
  }

  const addRes = await runGit(['add', 'data/user-progress.json']);
  if (!addRes.ok) {
    return { ok: false, error: addRes.stderr || 'Không thể git add data/user-progress.json' };
  }

  const msg = (commitMessage || '').trim() || `chore(progress): cap nhat tien do Kanji ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const diffRes = await runGit(['diff', '--cached', '--quiet']);
  let committed = false;

  if (!diffRes.ok) {
    const commitRes = await runGit(['commit', '-m', msg]);
    if (!commitRes.ok) {
      return { ok: false, error: commitRes.stderr || commitRes.stdout || 'Git commit thất bại' };
    }
    committed = true;
  }

  let pushed = false;
  let pushOutput = '';
  if (doPush) {
    if (!status.hasRemote) {
      return {
        ok: committed,
        committed,
        pushed: false,
        error: 'Đã commit nội bộ nhưng chưa cấu hình remote "origin" để push lên GitHub.',
      };
    }
    const pushRes = await runGit(['push']);
    if (!pushRes.ok) {
      return {
        ok: false,
        committed,
        pushed: false,
        error: pushRes.stderr || pushRes.stdout || 'Git push thất bại',
      };
    }
    pushed = true;
    pushOutput = pushRes.stdout || pushRes.stderr || 'Đã push lên GitHub';
  }

  const updatedStatus = await getGitStatus();
  return {
    ok: true,
    committed,
    pushed,
    pushOutput,
    status: updatedStatus,
  };
}

function serveStatic(req, res) {
  const reqPath = req.url || '/';
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath.split('?')[0];
  const decoded = decodeURIComponent(cleanPath);
  const absPath = path.normalize(path.join(ROOT_DIR, decoded));

  if (!absPath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (absPath.includes(`${path.sep}.git`) || absPath.includes(`${path.sep}scripts${path.sep}.cache`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheControl = ext === '.json' && absPath.includes('user-progress') ? 'no-store' : 'no-cache';
    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, total - parseInt(m[2], 10));
      const end = m[1] && m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
        'Cache-Control': cacheControl,
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(absPath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(absPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  try {
    if (urlPath === '/api/progress' && req.method === 'GET') {
      const progress = readProgress();
      return sendJson(res, 200, progress);
    }

    if (urlPath === '/api/progress' && req.method === 'POST') {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const saved = writeProgress(parsed);
      return sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt });
    }

    if (urlPath === '/api/git-status' && req.method === 'GET') {
      const status = await getGitStatus();
      return sendJson(res, 200, status);
    }

    if (urlPath === '/api/git-save' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const result = await handleGitSave(Boolean(body.push), body.message);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res);
    }

    res.writeHead(405);
    res.end('Method not allowed');
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || 'Internal Server Error' });
  }
});

ensureProgressFile();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`BOKUSEKI server running at http://localhost:${PORT}`);
  console.log(`Progress saved locally at: ${PROGRESS_FILE}`);
});
