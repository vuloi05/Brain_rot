const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 3456;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROGRESS_FILE = process.env.BOKUSEKI_PROGRESS_FILE
  ? path.resolve(process.env.BOKUSEKI_PROGRESS_FILE)
  : path.join(DATA_DIR, 'user-progress.json');
const VOCAB_DICT_FILE = path.join(DATA_DIR, 'vocab-dict.json');
const KANJI_LOOKUP_FILE = path.join(DATA_DIR, 'kanji-lookup.json');
const EN_VOCAB_FILE = path.join(DATA_DIR, 'en-vocab.json');
const EN_DICT_API_BASE = (process.env.BOKUSEKI_EN_DICT_BASE || 'https://api.dictionaryapi.dev/api/v2/entries/en').replace(/\/+$/, '');
const EN_GT_API_BASE = (process.env.BOKUSEKI_EN_GT_BASE || 'https://translate.googleapis.com/translate_a/single').replace(/\/+$/, '');
const EN_MM_API_BASE = (process.env.BOKUSEKI_EN_MM_BASE || 'https://api.mymemory.translated.net/get').replace(/\/+$/, '');

let vocabDictCache = null;
let kanjiLookupCache = null;
let enVocabMapCache = null;

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
      enLevel: 'A1',
      enGlobal10k: false,
      enStatusFilter: 'today',
      enRootFilter: '',
      enLastWord: '',
      enDailyNewLimit: 10,
      enDailyNewDate: '',
      enDailyNewCount: 0,
      jpDailyNewLimit: 10,
      jpDailyNewDate: '',
      jpDailyNewCount: 0,
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
    enVocab: {},
    readingsDone: {},
    customReadings: [],
    enReadingsDone: {},
    enReadingNotes: {},
    enCustomReadings: [],
    sentencesDone: {},
    examNotes: {},
    sessionLogs: [],
  };
}

function ensureProgressFile() {
  const progressDir = path.dirname(PROGRESS_FILE);
  if (!fs.existsSync(progressDir)) {
    fs.mkdirSync(progressDir, { recursive: true });
  }
  if (!fs.existsSync(PROGRESS_FILE)) {
    const initial = createDefaultProgress();
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readProgress() {
  ensureProgressFile();
  const raw = fs.readFileSync(PROGRESS_FILE, 'utf-8');
  const parsed = JSON.parse(raw);
  const defaults = createDefaultProgress();
  if (!isPlainObject(parsed)) return defaults;
  return {
    ...defaults,
    ...parsed,
    settings: { ...defaults.settings, ...(isPlainObject(parsed.settings) ? parsed.settings : {}) },
    stats: { ...defaults.stats, ...(isPlainObject(parsed.stats) ? parsed.stats : {}) },
  };
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
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(json);
}

function readBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const contentLen = Number(req.headers['content-length']);
    if (Number.isFinite(contentLen) && contentLen > maxBytes) {
      settled = true;
      const err = new Error('Payload too large');
      err.statusCode = 413;
      reject(err);
      return;
    }
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        chunks.length = 0;
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    });
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function parseJsonBody(raw, allowEmpty = false) {
  if (!raw || !raw.trim()) {
    if (allowEmpty) return {};
    const err = new Error('Empty JSON body');
    err.statusCode = 400;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

function validateProgressPayload(parsed) {
  if (!isPlainObject(parsed)) {
    return 'Invalid progress payload: expected JSON object';
  }
  const objKeys = [
    'settings',
    'stats',
    'kanji',
    'enVocab',
    'readingsDone',
    'enReadingsDone',
    'enReadingNotes',
    'sentencesDone',
    'examNotes',
  ];
  for (const k of objKeys) {
    if (parsed[k] !== undefined && !isPlainObject(parsed[k])) {
      return `Invalid progress field "${k}": expected object`;
    }
  }
  const arrKeys = ['customReadings', 'enCustomReadings', 'sessionLogs'];
  for (const k of arrKeys) {
    if (parsed[k] !== undefined && !Array.isArray(parsed[k])) {
      return `Invalid progress field "${k}": expected array`;
    }
  }
  return null;
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

  let progressSummary = '';
  try {
    const prog = readProgress();
    const kCount = Object.keys(prog.kanji || {}).length;
    const enCount = Object.keys(prog.enVocab || {}).length;
    const enReadCount = Object.keys(prog.enReadingsDone || {}).length;
    progressSummary = ` [JP: ${kCount} kanji | EN: ${enCount} vocab | EN-Read: ${enReadCount}]`;
  } catch (_) {}

  const safeMsg = typeof commitMessage === 'string' ? commitMessage.trim() : '';
  const msg = safeMsg || `chore(progress): dong bo tien do${progressSummary} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
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

function isBlockedRelativePath(rel) {
  const segments = String(rel || '').split(/[\\/]+/).filter(Boolean).map((s) => s.toLowerCase());
  return (
    segments.includes('.git')
    || segments.includes('.agents')
    || segments.includes('node_modules')
    || (segments[0] === 'scripts' && segments.includes('.cache'))
  );
}

function serveStatic(req, res) {
  const reqPath = req.url || '/';
  const rawPath = reqPath.split('?')[0] || '/';
  const cleanPath = rawPath === '/' ? '/index.html' : rawPath;

  let decoded;
  try {
    decoded = decodeURIComponent(cleanPath);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('Bad Request');
    return;
  }

  if (decoded.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('Bad Request');
    return;
  }

  const absPath = path.normalize(path.join(ROOT_DIR, decoded));
  const rel = path.relative(ROOT_DIR, absPath);

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('Forbidden');
    return;
  }

  if (isBlockedRelativePath(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('Forbidden');
    return;
  }

  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      res.end('Not found');
      return;
    }

    let realRoot;
    let realFile;
    try {
      realRoot = fs.realpathSync(ROOT_DIR);
      realFile = fs.realpathSync(absPath);
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      res.end('Not found');
      return;
    }

    const realRel = path.relative(realRoot, realFile);
    if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel) || isBlockedRelativePath(realRel)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      res.end('Forbidden');
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
        res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'X-Content-Type-Options': 'nosniff' });
        res.end();
        return;
      }
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, total - parseInt(m[2], 10));
      const end = m[1] && m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'X-Content-Type-Options': 'nosniff' });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
        'Cache-Control': cacheControl,
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(realFile, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(realFile).pipe(res);
  });
}

const PYKAKASI_HELPER = `
import sys, json, re, pykakasi
sys.stdout.reconfigure(encoding='utf-8')
text = sys.argv[1]
kks = pykakasi.kakasi()
FIX = {'日本':'にほん','一日':'いちにち','六つ':'むっつ','何':'なに','方':'かた','十分':'じゅうぶん','今日':'きょう','明日':'あした','昨日':'きのう','今年':'ことし','大人':'おとな','一人':'ひとり','二人':'ふたり','四人':'よにん','大きい':'おおきい','小さい':'ちいさい','多い':'おおい','遠い':'とおい'}
KEEP = {'今日は','実は','一緒に','単に','単純に','同時に','非常に','逆に','最も','誰も','何も','何か','何と','静か','豊か','確か'}
PART = set('のをはがにへとでも')
EXT = {'お':'お','あ':'あ','か':'あ','さ':'あ','た':'あ','な':'あ','は':'あ','ま':'あ','や':'あ','ら':'あ','わ':'あ','が':'あ','ざ':'あ','だ':'あ','ば':'あ','ぱ':'あ','い':'い','き':'い','し':'い','ち':'い','に':'い','ひ':'い','み':'い','り':'い','ぎ':'い','じ':'い','び':'い','ぴ':'い','え':'い','け':'い','せ':'い','て':'い','ね':'い','へ':'い','め':'い','れ':'い','げ':'い','ぜ':'い','で':'い','べ':'い','ぺ':'い'}
def fix_h(orig, hira):
    if orig in FIX: return FIX[orig]
    if 'ー' not in hira or re.search(r'[\\u30a0-\\u30ff]', orig): return hira
    out = []
    for ch in hira:
        out.append(EXT.get(out[-1], 'う') if (ch == 'ー' and out) else ch)
    return ''.join(out)
items = kks.convert(text)
reading_parts = []
words = []
seen = set()
for it in items:
    orig = it['orig']
    hira = fix_h(orig, it['hira'])
    if orig not in KEEP and len(orig) >= 2 and orig[-1] in PART and re.match(r'^[\\u4e00-\\u9faf々]+$', orig[:-1]):
        bo = orig[:-1]
        bh = hira[:-1] if hira.endswith(orig[-1]) else fix_h(bo, kks.convert(bo)[0]['hira'])
        reading_parts.append(bh + orig[-1])
        if bo not in seen:
            seen.add(bo)
            words.append([bo, bh])
    else:
        reading_parts.append(hira)
        if re.search(r'[\\u4e00-\\u9faf]', orig) and orig not in seen:
            seen.add(orig)
            words.append([orig, hira])
print(json.dumps({'reading': ' '.join(p.strip() for p in reading_parts if p.strip()), 'words': words}, ensure_ascii=False))
`.trim();

function loadVocabDict() {
  if (vocabDictCache) return vocabDictCache;
  try {
    vocabDictCache = JSON.parse(fs.readFileSync(VOCAB_DICT_FILE, 'utf-8'));
  } catch (_) {
    vocabDictCache = {};
  }
  return vocabDictCache;
}

function saveVocabEntry(word, entry) {
  const dict = loadVocabDict();
  dict[word] = entry;
  try {
    const tmp = `${VOCAB_DICT_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dict, null, 2), 'utf-8');
    fs.renameSync(tmp, VOCAB_DICT_FILE);
  } catch (_) {}
}

function loadKanjiLookup() {
  if (kanjiLookupCache) return kanjiLookupCache;
  try {
    kanjiLookupCache = JSON.parse(fs.readFileSync(KANJI_LOOKUP_FILE, 'utf-8'));
  } catch (_) {
    kanjiLookupCache = {};
  }
  return kanjiLookupCache;
}

function computeHanViet(word) {
  const lookup = loadKanjiLookup();
  const parts = [];
  for (const ch of word || '') {
    if (lookup[ch] && lookup[ch].hv) parts.push(lookup[ch].hv);
  }
  return parts.join(' ');
}

function computeKanjiFallbackMeaning(word) {
  const lookup = loadKanjiLookup();
  const parts = [];
  for (const ch of word || '') {
    if (lookup[ch] && lookup[ch].vi) {
      parts.push(`${ch} (${lookup[ch].vi.split(',')[0].trim()})`);
    }
  }
  return parts.join(' + ');
}

function candidateBaseForms(word) {
  const map = {
    'い': ['う', 'いる'], 'き': ['く', 'きる'], 'ぎ': ['ぐ', 'ぎる'], 'し': ['す', 'する'],
    'ち': ['つ', 'ちる'], 'に': ['ぬ', 'にる'], 'び': ['ぶ', 'びる'], 'み': ['む', 'みる'],
    'り': ['る'], 'え': ['える'], 'け': ['ける'], 'げ': ['げる'], 'せ': ['せる'],
    'て': ['てる'], 'ね': ['ねる'], 'べ': ['べる'], 'め': ['める'], 'れ': ['れる'],
    'っ': ['う', 'つ', 'る'], 'ん': ['ぶ', 'む', 'ぬ'], 'く': ['い'], 'かっ': ['い'],
    'きて': ['きる'], 'いて': ['く', 'いる'], 'って': ['う', 'つ', 'る'], 'んで': ['ぶ', 'む', 'ぬ'],
    'して': ['す', 'する'], 'べて': ['べる'], 'めて': ['める'], 'れて': ['れる'],
    'ました': ['る', 'う', 'く'], 'ます': ['る', 'う', 'く'],
  };
  const out = [word];
  for (const [suf, repls] of Object.entries(map)) {
    if (word.endsWith(suf) && word.length > suf.length) {
      const stem = word.slice(0, word.length - suf.length);
      for (const r of repls) out.push(stem + r);
    }
  }
  return Array.from(new Set(out));
}

function httpRequestJson(urlStr, options = {}, bodyObj = null, timeoutMs = 3500) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (_) {
      return resolve(null);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return resolve(null);
    }
    const signal = options && options.signal ? options.signal : null;
    if (signal && signal.aborted) {
      return resolve(null);
    }

    const isHttp = parsed.protocol === 'http:';
    const transport = isHttp ? http : https;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttp ? 80 : 443),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const MAX_RESP_BYTES = 1024 * 1024;
    let settled = false;
    let req = null;
    let wallTimer = null;
    const onAbort = () => {
      try {
        if (req) req.destroy();
      } catch (_) {}
      finish(null);
    };
    const finish = (val) => {
      if (!settled) {
        settled = true;
        if (wallTimer) {
          clearTimeout(wallTimer);
          wallTimer = null;
        }
        if (signal) {
          try {
            signal.removeEventListener('abort', onAbort);
          } catch (_) {}
        }
        resolve(val);
      }
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    wallTimer = setTimeout(() => {
      try {
        if (req) req.destroy();
      } catch (_) {}
      finish(null);
    }, timeoutMs);
    if (typeof wallTimer.unref === 'function') wallTimer.unref();

    req = transport.request(reqOpts, (res) => {
      const chunks = [];
      let totalBytes = 0;
      res.on('data', (c) => {
        if (settled) return;
        totalBytes += c.length;
        if (totalBytes > MAX_RESP_BYTES) {
          try {
            req.destroy();
          } catch (_) {}
          finish(null);
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        if (settled) return;
        try {
          const text = Buffer.concat(chunks).toString('utf-8');
          finish(res.statusCode >= 200 && res.statusCode < 300 ? JSON.parse(text) : null);
        } catch (_) {
          finish(null);
        }
      });
      res.on('error', () => finish(null));
      res.on('aborted', () => finish(null));
    });
    req.setTimeout(timeoutMs, () => {
      try {
        req.destroy();
      } catch (_) {}
      finish(null);
    });
    req.on('error', () => finish(null));
    if (bodyObj) {
      req.write(JSON.stringify(bodyObj));
    }
    req.end();
  });
}

function stripHtmlTags(str) {
  return String(str == null ? '' : str).replace(/<[^>]*>?/g, '').replace(/\s+/g, ' ').trim();
}

async function queryMaziiWord(text) {
  const cands = candidateBaseForms(text);
  const res = await httpRequestJson(
    'https://mazii.net/api/search',
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { dict: 'javi', type: 'word', query: text, limit: 8, page: 1 },
    3500
  );
  let items = (res && Array.isArray(res.data)) ? res.data : [];
  let hit = items.find((x) => x.word === text) || null;
  let baseUsed = null;
  if (!hit) {
    hit = items.find((x) => cands.includes(x.word)) || null;
    if (hit) baseUsed = hit.word;
  }
  if (!hit && cands.length > 1) {
    const baseRes = await httpRequestJson(
      'https://mazii.net/api/search',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { dict: 'javi', type: 'word', query: cands[1], limit: 5, page: 1 },
      3500
    );
    const bItems = (baseRes && Array.isArray(baseRes.data)) ? baseRes.data : [];
    hit = bItems.find((x) => cands.includes(x.word)) || null;
    if (hit) baseUsed = hit.word;
  }
  if (!hit) return null;
  const mean = stripHtmlTags(hit.short_mean || (hit.means && hit.means[0] && hit.means[0].mean) || '');
  const phon = ((hit.phonetic || '').split(' ')[0] || '').trim();
  return {
    reading: baseUsed ? '' : phon,
    meaning: baseUsed && baseUsed !== text ? `${mean} (${baseUsed})` : mean,
    hv: (hit.han || '').trim(),
  };
}

async function queryMyMemoryTranslate(text) {
  if (!text) return '';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ja|vi`;
  const res = await httpRequestJson(url, { method: 'GET' }, null, 4000);
  const translated = res && res.responseData && res.responseData.translatedText ? String(res.responseData.translatedText).trim() : '';
  if (!translated || translated.toUpperCase().includes('MYMEMORY WARNING')) return '';
  return translated;
}

function getFuriganaViaPykakasi(text) {
  return new Promise((resolve) => {
    execFile(
      'python',
      ['-c', PYKAKASI_HELPER, text],
      { cwd: ROOT_DIR, timeout: 4000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
      (err, stdout) => {
        if (err || !stdout) return resolve({ reading: '', words: [] });
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (_) {
          resolve({ reading: '', words: [] });
        }
      }
    );
  });
}

const phraseLookupCache = new Map();

async function lookupJapaneseText(rawText) {
  const text = (rawText || '').trim();
  const dict = loadVocabDict();
  const hv = computeHanViet(text);

  if (dict[text]) {
    return {
      ok: true,
      text,
      reading: dict[text].r || text,
      meaning: dict[text].m || '',
      hv: dict[text].hv || hv,
      words: [[text, dict[text].r || text, dict[text].m || '', dict[text].hv || hv]],
      isSingleWord: true,
      source: 'local',
    };
  }
  if (phraseLookupCache.has(text)) {
    return phraseLookupCache.get(text);
  }

  const isShortWord = text.length <= 12 && !/[。、？！\n]/.test(text);
  const [pyRes, maziiRes, initialMm] = await Promise.all([
    getFuriganaViaPykakasi(text),
    isShortWord ? queryMaziiWord(text) : Promise.resolve(null),
    isShortWord ? Promise.resolve('') : queryMyMemoryTranslate(text),
  ]);

  let mmRes = initialMm;
  let meaning = (maziiRes && maziiRes.meaning) || mmRes || '';
  if (!meaning && isShortWord) {
    mmRes = await queryMyMemoryTranslate(text);
    meaning = mmRes || '';
  }
  if (!meaning) {
    meaning = computeKanjiFallbackMeaning(text) || 'Chưa có bản dịch trực tuyến';
  }

  let reading = (maziiRes && maziiRes.reading) || (pyRes && pyRes.reading) || text;
  if (/[\u30a0-\u30ff]/.test(reading) && !/[\u30a0-\u30ff]/.test(text) && pyRes && pyRes.reading) {
    reading = pyRes.reading;
  }
  const finalHv = (maziiRes && maziiRes.hv) || hv;

  const words = (pyRes && pyRes.words ? pyRes.words : []).map(([w, r]) => {
    const cached = dict[w];
    return [
      w,
      (cached && cached.r) || r,
      (cached && cached.m) || computeKanjiFallbackMeaning(w),
      (cached && cached.hv) || computeHanViet(w),
    ];
  });

  const isSingleWord = Boolean(
    isShortWord
    && (maziiRes || (pyRes && Array.isArray(pyRes.words) && pyRes.words.length === 1 && !/\s/.test(reading)))
    && !/[のをはがにへとでもか、。]$/.test(text)
  );

  if (isSingleWord && meaning && !meaning.includes('Chưa có bản dịch')) {
    saveVocabEntry(text, { r: reading, m: meaning, hv: finalHv });
  }

  const payload = {
    ok: true,
    text,
    reading,
    meaning,
    hv: finalHv,
    words,
    isSingleWord,
    source: maziiRes ? 'mazii+pykakasi' : mmRes ? 'mymemory+pykakasi' : 'offline',
  };
  if (phraseLookupCache.size > 300) phraseLookupCache.clear();
  phraseLookupCache.set(text, payload);
  return payload;
}

const enLookupCache = new Map();

function loadEnVocabMap() {
  if (enVocabMapCache) return enVocabMapCache;
  const map = new Map();
  try {
    const items = JSON.parse(fs.readFileSync(EN_VOCAB_FILE, 'utf-8'));
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item && item.w) {
          map.set(String(item.w).trim().toLowerCase(), item);
        }
      }
    }
  } catch (_) {}
  enVocabMapCache = map;
  return enVocabMapCache;
}

function findLocalEnVocabEntry(word) {
  const map = loadEnVocabMap();
  if (map.has(word)) return map.get(word);

  const normalized = word.replace(/\u2019/g, "'");
  const clean = normalized.replace(/'s$/i, '').replace(/'$/i, '');
  if (clean && map.has(clean)) return map.get(clean);

  const base = clean || normalized;
  const candidates = [];
  // -ies -> -y, -es, -s
  if (base.endsWith('ies') && base.length > 4) candidates.push(`${base.slice(0, -3)}y`);
  if (base.endsWith('es') && base.length > 3) candidates.push(base.slice(0, -2));
  if (base.endsWith('s') && base.length > 2 && !base.endsWith('ss')) candidates.push(base.slice(0, -1));

  // -ied -> -y, doubled consonant + ed, -ed, -ed -> -e, -d
  if (base.endsWith('ied') && base.length > 4) candidates.push(`${base.slice(0, -3)}y`);
  if (base.endsWith('ed') && base.length > 4) {
    const stem = base.slice(0, -2);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      candidates.push(stem.slice(0, -1));
    }
    candidates.push(stem);
    candidates.push(`${stem}e`);
  }
  if (base.endsWith('d') && base.length > 3) candidates.push(base.slice(0, -1));

  // doubled consonant + ing, -ing, -ing -> -e
  if (base.endsWith('ing') && base.length >= 5) {
    const stem = base.slice(0, -3);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      candidates.push(stem.slice(0, -1));
    }
    candidates.push(stem);
    candidates.push(`${stem}e`);
  }

  // -ily -> -y, -ly, -ly -> -le
  if (base.endsWith('ily') && base.length > 4) candidates.push(`${base.slice(0, -3)}y`);
  if (base.endsWith('ly') && base.length > 4) {
    const stem = base.slice(0, -2);
    candidates.push(stem);
    candidates.push(`${stem}le`);
  }

  for (const cand of candidates) {
    if (map.has(cand)) return map.get(cand);
  }
  return null;
}

async function queryGoogleTranslateEnVi(word, timeoutMs, signal) {
  const sep = EN_GT_API_BASE.includes('?') ? '&' : '?';
  const gUrl = `${EN_GT_API_BASE}${sep}client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(word)}`;
  const gRes = await httpRequestJson(gUrl, { method: 'GET', signal }, null, timeoutMs);
  if (Array.isArray(gRes) && Array.isArray(gRes[0])) {
    const joined = stripHtmlTags(gRes[0].map((seg) => (Array.isArray(seg) ? seg[0] || '' : '')).join(''));
    if (joined && joined.toLowerCase() !== word.toLowerCase()) return joined;
  }
  return '';
}

async function queryMyMemoryEnVi(word, timeoutMs, signal) {
  const sep = EN_MM_API_BASE.includes('?') ? '&' : '?';
  const mmUrl = `${EN_MM_API_BASE}${sep}q=${encodeURIComponent(word)}&langpair=en|vi`;
  const mmRes = await httpRequestJson(mmUrl, { method: 'GET', signal }, null, timeoutMs);
  const mmText = mmRes?.responseData?.translatedText ? stripHtmlTags(String(mmRes.responseData.translatedText)) : '';
  return mmText && !mmText.toUpperCase().includes('MYMEMORY WARNING') && mmText.toLowerCase() !== word.toLowerCase()
    ? mmText
    : '';
}

async function translateEnglishToVi(word, externalSignal = null) {
  if (externalSignal && externalSignal.aborted) return '';
  const ac = new AbortController();
  const onExternalAbort = () => ac.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await new Promise((resolve) => {
      let settled = false;
      let remaining = 2;
      const done = (val) => {
        if (!settled) {
          settled = true;
          ac.abort();
          resolve(val || '');
        }
      };

      const gPromise = queryGoogleTranslateEnVi(word, 2500, ac.signal);
      const mmPromise = queryMyMemoryEnVi(word, 2500, ac.signal);

      const handleProvider = (p) => {
        p.then(
          (val) => {
            if (val) {
              done(val);
            } else {
              remaining -= 1;
              if (remaining <= 0) done('');
            }
          },
          () => {
            remaining -= 1;
            if (remaining <= 0) done('');
          }
        );
      };

      handleProvider(gPromise);
      handleProvider(mmPromise);
    });
  } finally {
    if (externalSignal) {
      try {
        externalSignal.removeEventListener('abort', onExternalAbort);
      } catch (_) {}
    }
  }
}

async function lookupEnglishWord(rawWord) {
  const rawStr = String(rawWord == null ? '' : rawWord).trim();
  if (!rawStr || /[\x00-\x1f<>]/.test(rawStr)) {
    return { ok: false, error: 'Từ Tiếng Anh không hợp lệ' };
  }
  const word = rawStr.toLowerCase().replace(/[^a-z'-]/g, '');
  if (!word || !/[a-z]/.test(word) || word.length > 64) {
    return { ok: false, error: 'Từ Tiếng Anh không hợp lệ' };
  }

  const localHit = findLocalEnVocabEntry(word);
  if (localHit) {
    return {
      ok: true,
      found: true,
      offline: false,
      word,
      ...(localHit.w !== word ? { baseWord: localHit.w } : {}),
      ipa: localHit.ipa || `/${word}/`,
      pos: localHit.pos || 'word',
      vi: localHit.vi || '',
      enDef: localHit.enDef || '',
      exampleEn: localHit.exampleEn || '',
    };
  }

  if (enLookupCache.has(word)) return enLookupCache.get(word);

  const dictUrl = `${EN_DICT_API_BASE}/${encodeURIComponent(word)}`;
  const ac = new AbortController();
  let deadlineTimer = null;
  const deadlinePromise = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => {
      ac.abort();
      resolve([null, '']);
    }, 3200);
    if (typeof deadlineTimer.unref === 'function') deadlineTimer.unref();
  });

  let dictRes = null;
  let viResRaw = '';
  try {
    [dictRes, viResRaw] = await Promise.race([
      Promise.all([
        httpRequestJson(dictUrl, { method: 'GET', signal: ac.signal }, null, 2500),
        translateEnglishToVi(word, ac.signal),
      ]),
      deadlinePromise,
    ]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    ac.abort();
  }
  const viRes = stripHtmlTags(viResRaw);

  let ipa = '';
  let pos = '';
  let enDef = '';
  let exampleEn = '';
  const hasDict = Array.isArray(dictRes) && Boolean(dictRes[0]);

  if (hasDict) {
    const entry = dictRes[0];
    ipa = stripHtmlTags(entry.phonetic || '');
    if (!ipa && Array.isArray(entry.phonetics)) {
      const hitPhon = entry.phonetics.find((p) => p && p.text);
      if (hitPhon) ipa = stripHtmlTags(String(hitPhon.text));
    }
    if (Array.isArray(entry.meanings) && entry.meanings[0]) {
      const m0 = entry.meanings[0];
      pos = stripHtmlTags(m0.partOfSpeech || '');
      const defs = Array.isArray(m0.definitions) ? m0.definitions : [];
      if (defs[0] && defs[0].definition) enDef = stripHtmlTags(String(defs[0].definition));
      for (const m of entry.meanings) {
        const hitEx = (m.definitions || []).find((d) => d && d.example);
        if (hitEx) {
          exampleEn = stripHtmlTags(String(hitEx.example));
          break;
        }
      }
    }
  }

  const hasVi = Boolean(viRes);
  const found = hasDict || hasVi;
  const offline = !hasDict && !hasVi;

  const payload = {
    ok: true,
    found,
    offline,
    word,
    ipa: ipa || `/${word}/`,
    pos: pos || 'word',
    vi: viRes || enDef || 'Chưa có nghĩa trực tuyến',
    enDef: enDef || '',
    exampleEn,
  };
  if (found) {
    if (enLookupCache.size > 400) enLookupCache.clear();
    enLookupCache.set(word, payload);
  }
  return payload;
}

const server = http.createServer(async (req, res) => {
  try {
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    } catch (_) {
      return sendJson(res, 400, { ok: false, error: 'Invalid request URL' });
    }
    const urlPath = parsedUrl.pathname;

    if (urlPath === '/api/progress' && req.method === 'GET') {
      const progress = readProgress();
      return sendJson(res, 200, progress);
    }

    if (urlPath === '/api/progress' && req.method === 'POST') {
      const raw = await readBody(req);
      const parsed = parseJsonBody(raw, false);
      const validationErr = validateProgressPayload(parsed);
      if (validationErr) {
        return sendJson(res, 400, { ok: false, error: validationErr });
      }
      const saved = writeProgress(parsed);
      return sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt });
    }

    if (urlPath === '/api/lookup' && req.method === 'GET') {
      const q = (parsedUrl.searchParams.get('text') || '').trim();
      if (!q) return sendJson(res, 400, { ok: false, error: 'Thiếu tham số text' });
      const result = await lookupJapaneseText(q);
      return sendJson(res, 200, result);
    }

    if (urlPath === '/api/en-lookup' && req.method === 'GET') {
      const w = (parsedUrl.searchParams.get('word') || '').trim();
      if (!w) return sendJson(res, 400, { ok: false, error: 'Thiếu tham số word' });
      const result = await lookupEnglishWord(w);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (urlPath === '/api/lookup' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = parseJsonBody(raw, true);
      if (!isPlainObject(body)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid lookup payload: expected object' });
      }
      const paragraphs = Array.isArray(body.paragraphs) ? body.paragraphs.slice(0, 40) : [];
      const dict = loadVocabDict();
      const results = [];
      for (const p of paragraphs) {
        const jp = String(p || '').trim();
        if (!jp) continue;
        const [pyRes, vi] = await Promise.all([
          getFuriganaViaPykakasi(jp),
          queryMyMemoryTranslate(jp),
        ]);
        const words = (pyRes && pyRes.words ? pyRes.words : []).map(([w, r]) => {
          const cached = dict[w];
          return [
            w,
            (cached && cached.r) || r,
            (cached && cached.m) || computeKanjiFallbackMeaning(w),
            (cached && cached.hv) || computeHanViet(w),
          ];
        });
        results.push({ jp, vi: vi || '', words });
      }
      return sendJson(res, 200, { ok: true, results });
    }

    if (urlPath === '/api/git-status' && req.method === 'GET') {
      const status = await getGitStatus();
      return sendJson(res, 200, status);
    }

    if (urlPath === '/api/git-save' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = parseJsonBody(raw, true);
      if (!isPlainObject(body)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid git-save payload: expected object' });
      }
      if (body.message !== undefined && typeof body.message !== 'string') {
        return sendJson(res, 400, { ok: false, error: 'Invalid git-save field "message": expected string' });
      }
      const result = await handleGitSave(Boolean(body.push), body.message);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res);
    }

    res.writeHead(405, { 'X-Content-Type-Options': 'nosniff' });
    res.end('Method not allowed');
  } catch (err) {
    const status = Number(err && err.statusCode) || 500;
    if (status === 413) {
      // Drain incoming oversized payload without buffering so client TCP write does not trigger RST (WinError 10053),
      // while bounding drain time/bytes to protect against unbounded streams.
      let drainedBytes = 0;
      const onDrainData = (chunk) => {
        drainedBytes += chunk.length;
        if (drainedBytes > 20 * 1024 * 1024) {
          req.removeListener('data', onDrainData);
          try {
            req.destroy();
          } catch (_) {}
        }
      };
      req.on('data', onDrainData);
      req.resume();
      const drainTimer = setTimeout(() => {
        req.removeListener('data', onDrainData);
        try {
          req.destroy();
        } catch (_) {}
      }, 2000);
      if (typeof drainTimer.unref === 'function') drainTimer.unref();
      req.once('end', () => {
        clearTimeout(drainTimer);
        req.removeListener('data', onDrainData);
      });
      req.socket?.once('close', () => {
        clearTimeout(drainTimer);
        req.removeListener('data', onDrainData);
      });
    }
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, error: err.message || 'Internal Server Error' });
    }
  }
});

ensureProgressFile();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`BOKUSEKI server running at http://localhost:${PORT}`);
  console.log(`Progress saved locally at: ${PROGRESS_FILE}`);
});
