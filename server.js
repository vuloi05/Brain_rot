const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 3456;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROGRESS_FILE = path.join(DATA_DIR, 'user-progress.json');
const VOCAB_DICT_FILE = path.join(DATA_DIR, 'vocab-dict.json');
const KANJI_LOOKUP_FILE = path.join(DATA_DIR, 'kanji-lookup.json');

let vocabDictCache = null;
let kanjiLookupCache = null;

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
    const parsed = new URL(urlStr);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    let settled = false;
    const finish = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf-8');
          finish(res.statusCode >= 200 && res.statusCode < 300 ? JSON.parse(text) : null);
        } catch (_) {
          finish(null);
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
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
  return (str || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const urlPath = parsedUrl.pathname;

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

    if (urlPath === '/api/lookup' && req.method === 'GET') {
      const q = (parsedUrl.searchParams.get('text') || '').trim();
      if (!q) return sendJson(res, 400, { ok: false, error: 'Thiếu tham số text' });
      const result = await lookupJapaneseText(q);
      return sendJson(res, 200, result);
    }

    if (urlPath === '/api/lookup' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
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
