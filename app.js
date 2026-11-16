(() => {
  'use strict';

  const STORAGE_KEY = 'bokuseki_progress_v1';
  const BATCH_SIZE = 120;
  const LEVEL_LIST = [5, 4, 3, 2, 1];
  const LEVEL_COUNTS = { 5: 79, 4: 166, 3: 367, 2: 367, 1: 1232 };
  const PART_COLORS_LIGHT = ['#1D4E68', '#C83E2B', '#2D6A4F', '#9C6615', '#6D4C7D', '#3D6B7E'];
  const PART_COLORS_DARK = ['#5BA4C8', '#E5624F', '#52B788', '#DDA15E', '#B388EB', '#70C1B3'];

  const POS_VI = {
    left: 'trái',
    right: 'phải',
    top: 'trên',
    bottom: 'dưới',
    kamae: 'bao quanh',
    tare: 'góc trên-trái',
    nyo: 'góc dưới-trái',
    nyou: 'góc dưới-trái',
    kamae1: 'vòng ngoài',
    kamae2: 'bên trong',
  };

  // --- State ---
  const state = {
    levelCache: {}, // { 5: [...], ... }
    componentsIndex: {},
    kanjiLookup: {}, // { '休': { l: 5, hv: 'HƯU', vi: '...' }, ... }
    currentLevel: 5,
    currentView: 'atelier', // 'atelier' | 'dojo' | 'neuro'
    currentMode: 'anatomy', // 'anatomy' | 'guided' | 'blind' | 'typing'
    currentKanji: null,
    filteredList: [],
    renderedCount: 0,
    filterStatus: 'all',
    searchQuery: '',
    globalSearch: false,
    activeComponentIdx: -1,
    anatomyStep: 999,
    animTimer: null,
    frictionTimer: null,
    frictionUnlockTime: 0,
    hasServerApi: true,
    saveTimer: null,
    noteTimer: null,
    // Focus session
    focusRunning: false,
    focusRemainingSec: 15 * 60,
    focusElapsedInSession: 0,
    focusInterval: null,
    detoxSkipToday: false,
    detoxInterval: null,
    // Dojo queue
    dojoQueue: [],
    dojoIndex: 0,
    dojoCurrent: null,
    dojoFrictionTimer: null,
    // Progress object persisted to data/user-progress.json
    progress: createDefaultProgress(),
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
      sessionLogs: [],
    };
  }

  // --- DOM Helpers ---
  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  // Hidden offscreen SVG path sampler so SVGPathElement.getTotalLength() is always exact
  const samplerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  samplerSvg.setAttribute('viewBox', '0 0 109 109');
  samplerSvg.style.cssText = 'position:fixed;width:0;height:0;opacity:0;pointer-events:none;';
  document.body.appendChild(samplerSvg);

  function sampleSvgPath(d, n = 24) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    samplerSvg.appendChild(p);
    const total = p.getTotalLength();
    const pts = [];
    for (let i = 0; i < n; i++) {
      const pt = p.getPointAtLength((total * i) / Math.max(1, n - 1));
      pts.push({ x: pt.x, y: pt.y });
    }
    samplerSvg.removeChild(p);
    return { pts, length: total };
  }

  // --- Text & Romaji Normalization ---
  function stripVietnamese(str) {
    return (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
  }

  const ROMAJI_TABLE = [
    ['ltsu', 'っ'], ['xtsu', 'っ'], ['kya', 'きゃ'], ['kyu', 'きゅ'], ['kyo', 'きょ'],
    ['sha', 'しゃ'], ['shu', 'しゅ'], ['sho', 'しょ'], ['sya', 'しゃ'], ['syu', 'しゅ'], ['syo', 'しょ'],
    ['cha', 'ちゃ'], ['chu', 'ちゅ'], ['cho', 'ちょ'], ['tya', 'ちゃ'], ['tyu', 'ちゅ'], ['tyo', 'ちょ'],
    ['nya', 'にゃ'], ['nyu', 'にゅ'], ['nyo', 'にょ'], ['hya', 'ひゃ'], ['hyu', 'ひゅ'], ['hyo', 'ひょ'],
    ['mya', 'みゃ'], ['myu', 'みゅ'], ['myo', 'みょ'], ['rya', 'りゃ'], ['ryu', 'りゅ'], ['ryo', 'りょ'],
    ['gya', 'ぎゃ'], ['gyu', 'ぎゅ'], ['gyo', 'ぎょ'], ['ja', 'じゃ'], ['ju', 'じゅ'], ['jo', 'じょ'],
    ['jya', 'じゃ'], ['jyu', 'じゅ'], ['jyo', 'じょ'], ['zya', 'じゃ'], ['zyu', 'じゅ'], ['zyo', 'じょ'],
    ['bya', 'びゃ'], ['byu', 'びゅ'], ['byo', 'びょ'], ['pya', 'ぴゃ'], ['pyu', 'ぴゅ'], ['pyo', 'ぴょ'],
    ['shi', 'し'], ['chi', 'ち'], ['tsu', 'つ'], ['fu', 'ふ'], ['ji', 'じ'],
    ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
    ['sa', 'さ'], ['si', 'し'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
    ['ta', 'た'], ['ti', 'ち'], ['tu', 'つ'], ['te', 'て'], ['to', 'と'],
    ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
    ['ha', 'は'], ['hi', 'ひ'], ['hu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
    ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
    ['ya', 'や'], ['yu', 'ゆ'], ['yo', 'よ'],
    ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
    ['wa', 'わ'], ['wo', 'を'],
    ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
    ['za', 'ざ'], ['zi', 'じ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
    ['da', 'だ'], ['di', 'ぢ'], ['du', 'づ'], ['de', 'で'], ['do', 'ど'],
    ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
    ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
    ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],
    ["n'", 'ん'], ['nn', 'ん'],
  ];

  function romajiToHiragana(input) {
    const src = (input || '').toLowerCase().trim();
    let out = '';
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      // Double consonant -> sokuon っ (except n)
      if (i + 1 < src.length && ch === src[i + 1] && /[bcdfghjklmpqrstvwxyz]/.test(ch)) {
        out += 'っ';
        i += 1;
        continue;
      }
      if (src.slice(i, i + 3) === 'tch') {
        out += 'っ';
        i += 1;
        continue;
      }
      let matched = false;
      for (const [rom, kana] of ROMAJI_TABLE) {
        if (src.startsWith(rom, i)) {
          out += kana;
          i += rom.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      // Single n before consonant (not y/n/vowel) -> ん
      if (ch === 'n' && i + 1 < src.length && !/[aiueoyn']/.test(src[i + 1])) {
        out += 'ん';
        i += 1;
        continue;
      }
      if (ch === 'n' && i === src.length - 1) {
        out += 'ん';
        i += 1;
        continue;
      }
      if (ch === '-') {
        out += 'ー';
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
    }
    return out;
  }

  function toHiragana(str) {
    return (str || '').replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  function cleanReadingToken(r) {
    return toHiragana((r || '').replace(/[-.]/g, '').trim());
  }

  // --- Audio: Optional Gentle Mokugyo Woodblock Sound & Web Speech ---
  let audioCtx = null;
  function playWoodTap(good = true) {
    if (!state.progress.settings.soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(good ? 480 : 210, now);
      osc.frequency.exponentialRampToValueAtTime(good ? 260 : 120, now + 0.08);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch (_) {}
  }

  function speakJapanese(entry) {
    if (!entry || !('speechSynthesis' in window)) return;
    const raw = (entry.kun[0] || entry.on[0] || entry.c).replace(/[-.]/g, '');
    const utt = new SpeechSynthesisUtterance(raw);
    utt.lang = 'ja-JP';
    utt.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  }

  // --- Persistence (Local Disk via server.js + localStorage fallback) ---
  function setSaveBadge(text, unsaved = false) {
    const badge = $('saveStatusBadge');
    badge.textContent = text;
    badge.classList.toggle('unsaved', unsaved);
  }

  async function loadProgress() {
    let loaded = null;
    try {
      const res = await fetch('/api/progress', { cache: 'no-store' });
      if (res.ok) {
        loaded = await res.json();
        state.hasServerApi = true;
      } else {
        state.hasServerApi = false;
      }
    } catch (_) {
      state.hasServerApi = false;
    }

    if (!loaded) {
      try {
        const ls = localStorage.getItem(STORAGE_KEY);
        if (ls) loaded = JSON.parse(ls);
      } catch (_) {}
    }

    const base = createDefaultProgress();
    if (loaded) {
      state.progress = {
        ...base,
        ...loaded,
        settings: { ...base.settings, ...(loaded.settings || {}) },
        stats: { ...base.stats, ...(loaded.stats || {}) },
        kanji: loaded.kanji || {},
        sessionLogs: loaded.sessionLogs || [],
      };
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    } catch (_) {}

    setSaveBadge(state.hasServerApi ? 'Đã lưu ổ đĩa' : 'Lưu LocalStorage');
  }

  function scheduleSaveProgress(immediate = false) {
    state.progress.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    } catch (_) {}

    setSaveBadge('Đang lưu...', true);
    clearTimeout(state.saveTimer);
    const run = async () => {
      if (!state.hasServerApi) {
        setSaveBadge('Lưu LocalStorage');
        return;
      }
      try {
        const res = await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.progress),
        });
        if (res.ok) {
          setSaveBadge('Đã lưu data/user-progress.json');
        } else {
          setSaveBadge('Lỗi ghi đĩa', true);
        }
      } catch (_) {
        setSaveBadge('Chế độ ngoại tuyến');
      }
    };

    if (immediate) {
      run();
    } else {
      state.saveTimer = setTimeout(run, 350);
    }
  }

  // --- SRS Logic (SM-2 adapted) ---
  function getKanjiStatus(ch) {
    const rec = state.progress.kanji[ch];
    if (!rec || (!rec.reps && !rec.writePasses)) return 'new';
    if (rec.due && new Date(rec.due).getTime() <= Date.now()) return 'due';
    if ((rec.interval || 0) >= 7) return 'mastered';
    return 'learning';
  }

  function previewNextInterval(ch, quality) {
    const rec = state.progress.kanji[ch] || { reps: 0, interval: 0, ease: 2.5 };
    if (quality === 1) return 'Ôn ngay';
    let interval;
    if (quality === 2) {
      interval = Math.max(1, Math.round((rec.interval || 1) * 1.2));
    } else if (quality === 3) {
      if (rec.reps === 0) interval = 1;
      else if (rec.reps === 1) interval = 3;
      else interval = Math.round((rec.interval || 2) * (rec.ease || 2.5));
    } else {
      if (rec.reps === 0) interval = 4;
      else interval = Math.max(7, Math.round((rec.interval || 3) * (rec.ease || 2.5) * 1.3));
    }
    return `${interval} ngày`;
  }

  function recordSrsGrade(ch, quality) {
    const prev = state.progress.kanji[ch] || {
      reps: 0,
      interval: 0,
      ease: 2.5,
      writePasses: 0,
      blindPasses: 0,
      note: '',
    };

    let { reps, interval, ease } = prev;
    if (quality === 1) {
      reps = 0;
      interval = 0;
      ease = Math.max(1.3, ease - 0.2);
    } else {
      if (quality === 2) {
        interval = Math.max(1, Math.round((interval || 1) * 1.2));
        ease = Math.max(1.3, ease - 0.14);
      } else if (quality === 3) {
        if (reps === 0) interval = 1;
        else if (reps === 1) interval = 3;
        else interval = Math.round((interval || 2) * ease);
      } else {
        if (reps === 0) interval = 4;
        else interval = Math.max(7, Math.round((interval || 3) * ease * 1.3));
        ease = Math.min(2.9, ease + 0.12);
      }
      reps += 1;
    }

    const dueMs = quality === 1 ? Date.now() + 5 * 60 * 1000 : Date.now() + interval * 24 * 60 * 60 * 1000;
    state.progress.kanji[ch] = {
      ...prev,
      reps,
      interval,
      ease: Number(ease.toFixed(2)),
      due: new Date(dueMs).toISOString(),
      lastReviewedAt: new Date().toISOString(),
    };
    scheduleSaveProgress(true);
    updateDueBadge();
  }

  function getDueKanjiChars() {
    const now = Date.now();
    return Object.entries(state.progress.kanji)
      .filter(([, rec]) => rec.due && new Date(rec.due).getTime() <= now)
      .sort((a, b) => new Date(a[1].due) - new Date(b[1].due))
      .map(([ch]) => ch);
  }

  function updateDueBadge() {
    $('dueCountBadge').textContent = String(getDueKanjiChars().length);
  }

  // --- Data Loading ---
  async function loadLevel(level) {
    if (state.levelCache[level]) return state.levelCache[level];
    const res = await fetch(`data/kanji-n${level}.json`);
    const data = await res.json();
    state.levelCache[level] = data;
    return data;
  }

  async function ensureMetaIndexes() {
    const [compRes, lookupRes] = await Promise.all([
      fetch('data/components-index.json'),
      fetch('data/kanji-lookup.json'),
    ]);
    state.componentsIndex = await compRes.json();
    state.kanjiLookup = await lookupRes.json();
  }

  async function jumpToKanji(ch) {
    const info = state.kanjiLookup[ch];
    if (!info) return;
    if (info.l !== state.currentLevel) {
      await selectLevel(info.l, false);
    }
    const list = await loadLevel(info.l);
    const found = list.find((k) => k.c === ch);
    if (found) {
      selectKanji(found);
      if (state.currentView !== 'atelier') switchView('atelier');
    }
  }

  // --- Reusable Vector Stroke Matching Canvas Controller ---
  function createStrokeController({ svgEl, canvasEl, cornerEl, sealEl, feedbackEl, onComplete }) {
    let entry = null;
    let sampledStrokes = [];
    let currentIdx = 0;
    let showGhost = true;
    let hideAll = false;
    let isDrawing = false;
    let rawPoints = [];
    let hadHintOrFail = false;

    const ctx = canvasEl.getContext('2d');

    function syncCanvasSize() {
      const rect = canvasEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
        canvasEl.width = targetW;
        canvasEl.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function toKanjiCoords(clientX, clientY) {
      const rect = canvasEl.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * 109,
        y: ((clientY - rect.top) / rect.height) * 109,
        px: clientX - rect.left,
        py: clientY - rect.top,
      };
    }

    function polyLength(pts) {
      let sum = 0;
      for (let i = 1; i < pts.length; i++) {
        sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      return sum;
    }

    function resamplePoints(pts, n = 24) {
      if (pts.length === 0) return [];
      if (pts.length === 1) return Array(n).fill(pts[0]);
      const total = polyLength(pts);
      if (total < 0.01) return Array(n).fill(pts[0]);
      const out = [{ x: pts[0].x, y: pts[0].y }];
      const step = total / (n - 1);
      let acc = 0;
      let prev = pts[0];
      let idx = 1;
      while (out.length < n && idx < pts.length) {
        const curr = pts[idx];
        const seg = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        if (acc + seg >= step) {
          const ratio = (step - acc) / seg;
          const nx = prev.x + ratio * (curr.x - prev.x);
          const ny = prev.y + ratio * (curr.y - prev.y);
          const np = { x: nx, y: ny };
          out.push(np);
          prev = np;
          acc = 0;
        } else {
          acc += seg;
          prev = curr;
          idx++;
        }
      }
      while (out.length < n) out.push({ ...pts[pts.length - 1] });
      return out;
    }

    function dist(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function evaluateAgainst(userPts, refObj, blindMode) {
      const refPts = refObj.pts;
      const n = refPts.length;
      const lenUser = polyLength(userPts);
      const lenRef = refObj.length;
      const u = resamplePoints(userPts, n);

      const dStart = dist(u[0], refPts[0]);
      const dEnd = dist(u[n - 1], refPts[n - 1]);
      const dMid = dist(u[Math.floor(n / 2)], refPts[Math.floor(n / 2)]);
      let sumD = 0;
      let revSumD = 0;
      for (let i = 0; i < n; i++) {
        sumD += dist(u[i], refPts[i]);
        revSumD += dist(u[i], refPts[n - 1 - i]);
      }
      const dMean = sumD / n;
      const revMean = revSumD / n;

      // Centroid-aligned shape error (helpful in blind recall if user draws slightly offset)
      const uCx = u.reduce((s, p) => s + p.x, 0) / n;
      const uCy = u.reduce((s, p) => s + p.y, 0) / n;
      const rCx = refPts.reduce((s, p) => s + p.x, 0) / n;
      const rCy = refPts.reduce((s, p) => s + p.y, 0) / n;
      let shiftedSum = 0;
      for (let i = 0; i < n; i++) {
        shiftedSum += Math.hypot(u[i].x - uCx - (refPts[i].x - rCx), u[i].y - uCy - (refPts[i].y - rCy));
      }
      const dShifted = shiftedSum / n;

      // Direction cosine
      const vxU = u[n - 1].x - u[0].x;
      const vyU = u[n - 1].y - u[0].y;
      const vxR = refPts[n - 1].x - refPts[0].x;
      const vyR = refPts[n - 1].y - refPts[0].y;
      const magU = Math.hypot(vxU, vyU);
      const magR = Math.hypot(vxR, vyR);
      const cosSim = magU > 3 && magR > 3 ? (vxU * vxR + vyU * vyR) / (magU * magR) : 1;

      const isDot = lenRef < 15;
      const reverseLikely = !isDot && revMean + 5 < dMean && dist(u[0], refPts[n - 1]) < 28 && dist(u[n - 1], refPts[0]) < 28;

      if (isDot) {
        const tol = blindMode ? 34 : 26;
        const ok = dStart < tol && lenUser < 42;
        return { ok, score: dMean, reverse: false };
      }

      const posTol = blindMode ? 34 : 25;
      const meanTol = blindMode ? 28 : 22;
      const shapeTol = blindMode ? 17 : 18;
      const dirOk = cosSim >= 0.35 || dMid < 20;
      const ratioOk = lenUser >= Math.max(5, lenRef * 0.35) && lenUser <= Math.max(40, lenRef * 2.1);

      const ok = !reverseLikely && dirOk && ratioOk && (
        (dStart < posTol && dEnd < posTol && dMean < meanTol) ||
        (blindMode && dShifted < shapeTol && dStart < 42 && dEnd < 42)
      );

      return { ok, score: dMean + (reverseLikely ? 40 : 0), reverse: reverseLikely };
    }

    function renderSvg(peekIndex = -1) {
      if (!entry) return;
      svgEl.innerHTML = '';
      entry.strokes.forEach((d, idx) => {
        if (idx < currentIdx) {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('d', d);
          p.setAttribute('class', 'kvg-stroke-drawn');
          svgEl.appendChild(p);
        } else if (idx === peekIndex) {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('d', d);
          p.setAttribute('class', 'kvg-stroke-peek');
          svgEl.appendChild(p);
        } else if (showGhost && !hideAll) {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('d', d);
          p.setAttribute('class', 'kvg-stroke-guide');
          svgEl.appendChild(p);
        }
      });
      cornerEl.textContent = `Nét ${currentIdx} / ${entry.strokes.length}`;
    }

    function clearLiveCanvas() {
      const rect = canvasEl.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
    }

    function flashError(msg) {
      feedbackEl.textContent = msg;
      feedbackEl.className = 'board-feedback warn';
      playWoodTap(false);
    }

    function setOkFeedback(msg) {
      feedbackEl.textContent = msg;
      feedbackEl.className = 'board-feedback ok';
    }

    function handleStrokeEnd() {
      if (!isDrawing || !entry) return;
      isDrawing = false;
      clearLiveCanvas();

      if (rawPoints.length < 2 || currentIdx >= sampledStrokes.length) {
        rawPoints = [];
        return;
      }

      state.progress.stats.totalStrokesDrawn = (state.progress.stats.totalStrokesDrawn || 0) + 1;
      const curRes = evaluateAgainst(rawPoints, sampledStrokes[currentIdx], hideAll);

      if (curRes.ok) {
        currentIdx += 1;
        playWoodTap(true);
        renderSvg(-1);
        if (currentIdx >= entry.strokes.length) {
          sealEl.classList.add('stamped');
          setOkFeedback(`Hoàn tất chữ ${entry.c} (${entry.hv}) — ${entry.strokes.length}/${entry.strokes.length} nét chuẩn.`);
          if (onComplete) onComplete({ entry, clean: !hadHintOrFail, blind: hideAll });
        } else {
          feedbackEl.textContent = `Chuẩn nét ${currentIdx}/${entry.strokes.length}. Tiếp tục nét ${currentIdx + 1}.`;
          feedbackEl.className = 'board-feedback';
        }
        rawPoints = [];
        return;
      }

      hadHintOrFail = true;
      if (curRes.reverse) {
        flashError(`Ngược chiều bút ở nét ${currentIdx + 1}! Hãy kéo theo hướng được gợi ý.`);
        renderSvg(currentIdx);
        rawPoints = [];
        return;
      }

      // Check if user accidentally wrote a subsequent stroke out of order
      let matchedLater = -1;
      const lookahead = Math.min(sampledStrokes.length - 1, currentIdx + 3);
      for (let j = currentIdx + 1; j <= lookahead; j++) {
        const laterRes = evaluateAgainst(rawPoints, sampledStrokes[j], hideAll);
        if (laterRes.ok) {
          matchedLater = j;
          break;
        }
      }

      if (matchedLater !== -1) {
        flashError(`Sai thứ tự nét! Bạn vừa viết nét số ${matchedLater + 1}, cần viết nét ${currentIdx + 1} trước.`);
      } else {
        flashError(`Nét ${currentIdx + 1} chưa khớp. Xem đường nét gợi ý màu đỏ rồi thử lại.`);
      }
      renderSvg(currentIdx);
      rawPoints = [];
    }

    canvasEl.addEventListener('pointerdown', (e) => {
      if (canvasEl.classList.contains('disabled') || !entry || currentIdx >= entry.strokes.length) return;
      e.preventDefault();
      canvasEl.setPointerCapture(e.pointerId);
      syncCanvasSize();
      isDrawing = true;
      const pt = toKanjiCoords(e.clientX, e.clientY);
      rawPoints = [{ x: pt.x, y: pt.y }];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 10;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-vermilion').trim() || '#C83E2B';
      ctx.beginPath();
      ctx.moveTo(pt.px, pt.py);
    });

    canvasEl.addEventListener('pointermove', (e) => {
      if (!isDrawing) return;
      const pt = toKanjiCoords(e.clientX, e.clientY);
      rawPoints.push({ x: pt.x, y: pt.y });
      ctx.lineTo(pt.px, pt.py);
      ctx.stroke();
    });

    canvasEl.addEventListener('pointerup', handleStrokeEnd);
    canvasEl.addEventListener('pointercancel', handleStrokeEnd);

    return {
      setKanji(newEntry, opts = {}) {
        entry = newEntry;
        currentIdx = 0;
        hadHintOrFail = false;
        showGhost = opts.showGhost !== undefined ? opts.showGhost : true;
        hideAll = Boolean(opts.hideAll);
        sampledStrokes = entry ? entry.strokes.map((d) => sampleSvgPath(d, 24)) : [];
        sealEl.classList.remove('stamped');
        clearLiveCanvas();
        syncCanvasSize();
        renderSvg(-1);
      },
      setGhost(val) {
        showGhost = val;
        renderSvg(-1);
      },
      undo() {
        if (!entry || currentIdx === 0) return;
        currentIdx -= 1;
        sealEl.classList.remove('stamped');
        renderSvg(-1);
      },
      clear() {
        if (!entry) return;
        currentIdx = 0;
        hadHintOrFail = false;
        sealEl.classList.remove('stamped');
        clearLiveCanvas();
        renderSvg(-1);
      },
      peekNext() {
        if (!entry || currentIdx >= entry.strokes.length) return;
        hadHintOrFail = true;
        renderSvg(currentIdx);
      },
      revealAnswer() {
        if (!entry) return;
        hadHintOrFail = true;
        hideAll = false;
        showGhost = true;
        currentIdx = entry.strokes.length;
        renderSvg(-1);
      },
    };
  }

  const atelierController = createStrokeController({
    svgEl: $('kanjiSvg'),
    canvasEl: $('drawCanvas'),
    cornerEl: $('boardCornerInfo'),
    sealEl: $('hankoSeal'),
    feedbackEl: $('boardFeedback'),
    onComplete: ({ entry, clean, blind }) => {
      const prev = state.progress.kanji[entry.c] || { reps: 0, interval: 0, ease: 2.5, writePasses: 0, blindPasses: 0, note: '' };
      prev.writePasses = (prev.writePasses || 0) + 1;
      if (blind) {
        prev.blindPasses = (prev.blindPasses || 0) + 1;
        state.progress.stats.blindRecallTotalCount += 1;
        if (clean) state.progress.stats.blindRecallSuccessCount += 1;
      }
      if (!prev.due) {
        prev.due = new Date().toISOString();
      }
      state.progress.kanji[entry.c] = prev;
      scheduleSaveProgress();
      updateDueBadge();
      renderKanjiList('dots');
    },
  });

  const dojoController = createStrokeController({
    svgEl: $('dojoSvg'),
    canvasEl: $('dojoCanvas'),
    cornerEl: $('dojoCornerInfo'),
    sealEl: $('dojoHankoSeal'),
    feedbackEl: $('dojoFeedback'),
    onComplete: ({ entry, clean }) => {
      const prev = state.progress.kanji[entry.c] || { reps: 0, interval: 0, ease: 2.5, writePasses: 0, blindPasses: 0, note: '' };
      prev.writePasses = (prev.writePasses || 0) + 1;
      prev.blindPasses = (prev.blindPasses || 0) + 1;
      state.progress.stats.blindRecallTotalCount += 1;
      if (clean) state.progress.stats.blindRecallSuccessCount += 1;
      state.progress.kanji[entry.c] = prev;
      scheduleSaveProgress();
    },
  });

  // --- Anatomy Mode SVG Renderer ---
  function getPartColor(idx) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'yoru';
    const palette = isDark ? PART_COLORS_DARK : PART_COLORS_LIGHT;
    return palette[idx % palette.length];
  }

  function buildTopLevelStrokeColorMap(entry) {
    const map = {};
    const topParts = entry.parts.filter((p) => p.depth === 1);
    topParts.forEach((p, idx) => {
      const color = getPartColor(idx);
      p.strokes.forEach((sIdx) => {
        map[sIdx] = color;
      });
    });
    return map;
  }

  function renderAnatomySvg(animateStrokeIdx = -1) {
    const entry = state.currentKanji;
    if (!entry) return;
    const svg = $('kanjiSvg');
    svg.innerHTML = '';

    const colorParts = $('colorPartsToggle').checked;
    const showNumbers = $('strokeNumberToggle').checked;
    const colorMap = colorParts ? buildTopLevelStrokeColorMap(entry) : {};
    const activePart = state.activeComponentIdx >= 0 ? entry.parts[state.activeComponentIdx] : null;
    const activeSet = activePart ? new Set(activePart.strokes) : null;
    const maxStep = Math.min(state.anatomyStep, entry.strokes.length);

    entry.strokes.forEach((d, idx) => {
      const visible = idx < maxStep;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);

      if (!visible) {
        p.setAttribute('class', 'kvg-stroke-guide');
        svg.appendChild(p);
        return;
      }

      const isHighlighted = activeSet ? activeSet.has(idx) : false;
      let strokeColor = colorMap[idx] || 'var(--ink-primary)';
      if (activeSet) {
        strokeColor = isHighlighted ? 'var(--accent-vermilion)' : 'var(--ink-muted)';
      }

      p.setAttribute('class', 'kvg-stroke-drawn');
      p.style.stroke = strokeColor;
      p.style.opacity = activeSet && !isHighlighted ? '0.2' : '1';
      if (isHighlighted) p.style.strokeWidth = '4.8';

      if (idx === animateStrokeIdx) {
        const len = sampleSvgPath(d, 4).length;
        p.style.strokeDasharray = `${len}`;
        p.style.strokeDashoffset = `${len}`;
        p.classList.add('kvg-stroke-animating');
      }

      svg.appendChild(p);

      if (showNumbers) {
        const m = d.match(/^M\s*([-.\d]+)[,\s]+([-.\d]+)/i);
        if (m) {
          const x = Math.min(102, Math.max(4, parseFloat(m[1]) - 1.5));
          const y = Math.min(104, Math.max(6, parseFloat(m[2]) - 1.5));
          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', x);
          txt.setAttribute('y', y);
          txt.setAttribute('class', 'kvg-stroke-number');
          if (activeSet && !isHighlighted) txt.style.opacity = '0.2';
          txt.textContent = String(idx + 1);
          svg.appendChild(txt);
        }
      }
    });

    $('boardCornerInfo').textContent = `Nét ${maxStep} / ${entry.strokes.length}`;
  }

  function playStrokeAnimation() {
    const entry = state.currentKanji;
    if (!entry || state.currentMode !== 'anatomy') return;
    stopStrokeAnimation();
    state.activeComponentIdx = -1;
    let step = 1;
    state.anatomyStep = 1;
    renderAnatomySvg(0);

    state.animTimer = setInterval(() => {
      step += 1;
      if (step > entry.strokes.length) {
        stopStrokeAnimation();
        return;
      }
      state.anatomyStep = step;
      renderAnatomySvg(step - 1);
    }, 520);
  }

  function stopStrokeAnimation() {
    if (state.animTimer) {
      clearInterval(state.animTimer);
      state.animTimer = null;
    }
  }

  // --- 3-Second Friction Rule Helper ---
  function startFrictionCooldown(btn, labelAfter) {
    clearInterval(state.frictionTimer);
    let secs = 3;
    btn.disabled = true;
    btn.textContent = `${labelAfter} (${secs}s)`;
    state.frictionTimer = setInterval(() => {
      secs -= 1;
      if (secs <= 0) {
        clearInterval(state.frictionTimer);
        btn.disabled = false;
        btn.textContent = labelAfter;
      } else {
        btn.textContent = `${labelAfter} (${secs}s)`;
      }
    }, 1000);
  }

  // --- Mode Switching ---
  function setMode(mode) {
    stopStrokeAnimation();
    state.currentMode = mode;
    qsa('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    qsa('.control-group').forEach((g) => g.classList.toggle('hidden', g.dataset.forMode !== mode));

    const isTyping = mode === 'typing';
    $('masumeFrame').classList.toggle('hidden', isTyping);
    $('boardControls').classList.toggle('hidden', isTyping);
    $('boardFeedback').classList.toggle('hidden', isTyping);
    $('typingStage').classList.toggle('hidden', !isTyping);

    applyModeToCurrentKanji();
  }

  function applyModeToCurrentKanji() {
    const entry = state.currentKanji;
    if (!entry) return;

    const glyph = $('promptKanjiGlyph');
    const feedback = $('boardFeedback');
    const canvas = $('drawCanvas');
    $('hankoSeal').classList.remove('stamped');

    if (state.currentMode === 'blind') {
      glyph.textContent = '？';
      glyph.classList.add('masked');
      canvas.classList.remove('disabled');
      atelierController.setKanji(entry, { hideAll: true, showGhost: false });
      feedback.textContent = 'Chế độ Viết Mù: Mặt chữ đã ẩn. Hãy tự hình dung chữ và viết nét đầu tiên.';
      feedback.className = 'board-feedback';
      startFrictionCooldown($('blindHintBtn'), 'Gợi ý 1 nét');
      return;
    }

    glyph.textContent = entry.c;
    glyph.classList.remove('masked');

    if (state.currentMode === 'anatomy') {
      canvas.classList.add('disabled');
      state.anatomyStep = entry.strokes.length;
      renderAnatomySvg(-1);
      feedback.textContent = 'Di chuột lên bộ phận bên phải để soi vị trí nét, hoặc bấm "Phát hoạt ảnh".';
      feedback.className = 'board-feedback';
    } else if (state.currentMode === 'guided') {
      canvas.classList.remove('disabled');
      atelierController.setKanji(entry, {
        hideAll: false,
        showGhost: $('ghostGuideToggle').checked,
      });
      feedback.textContent = `Hãy viết nét 1/${entry.strokes.length} theo đúng thứ tự trên giấy Masume.`;
      feedback.className = 'board-feedback';
    } else if (state.currentMode === 'typing') {
      $('typingKanjiBig').textContent = entry.c;
      $('inputHanViet').value = '';
      $('inputReading').value = '';
      $('kanaPreviewBadge').textContent = '';
      $('typingResult').classList.add('hidden');
      startFrictionCooldown($('typingHintBtn'), 'Xem gợi ý');
    }
  }

  // --- Select Kanji & Render Right Anatomy Column ---
  function selectKanji(entry) {
    state.currentKanji = entry;
    state.activeComponentIdx = -1;

    // Update active state in left list
    qsa('.kanji-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.char === entry.c);
    });

    // Prompt strip
    $('promptHv').textContent = entry.hv;
    $('promptJlptTag').textContent = `JLPT N${entry.l} · ${entry.s} nét`;
    $('promptMeaning').textContent = entry.vi.slice(0, 4).join(' · ') || entry.en.slice(0, 3).join(' · ');
    const onStr = entry.on.length ? entry.on.join(', ') : '—';
    const kunStr = entry.kun.length ? entry.kun.join(', ') : '—';
    $('promptReadings').textContent = `On: ${onStr}   |   Kun: ${kunStr}`;

    // Right Column: Identity & Meanings
    $('shapeTag').textContent = entry.shape ? `${entry.shape} ${entry.shapeDesc || ''}`.trim() : 'Đơn thể';
    $('detailHv').textContent = entry.hvAll.length > 1 ? `${entry.hv} (${entry.hvAll.join(', ')})` : entry.hv;
    $('detailRadical').textContent = entry.rad || '—';
    $('detailMeta').textContent = `N${entry.l} · ${entry.s} nét${entry.f ? ` · #${entry.f}` : ''}`;

    const meaningsUl = $('detailMeanings');
    meaningsUl.innerHTML = '';
    entry.vi.forEach((m) => {
      const li = document.createElement('li');
      li.textContent = m;
      meaningsUl.appendChild(li);
    });
    if (entry.en.length) {
      const li = document.createElement('li');
      li.className = 'meaning-en';
      li.textContent = `EN: ${entry.en.join(', ')}`;
      meaningsUl.appendChild(li);
    }

    // Component Tree
    renderComponentTree(entry);

    // Related Kanji based on first component
    const firstPart = entry.parts[0];
    renderRelatedKanji(firstPart ? (firstPart.orig || firstPart.el) : entry.c, entry.c);

    // Mnemonic Note & SRS Status
    const rec = state.progress.kanji[entry.c] || {};
    $('mnemonicNoteInput').value = rec.note || '';
    $('noteSaveHint').textContent = 'Tự lưu vào ổ đĩa';
    const status = getKanjiStatus(entry.c);
    const statusText = {
      new: 'Chưa học',
      due: 'Cần ôn ngay',
      learning: `Đang luyện (${rec.interval || 0} ngày)`,
      mastered: `Thuộc sâu (${rec.interval} ngày)`,
    }[status];
    $('srsStatusLabel').textContent = statusText;

    qsa('.srs-next').forEach((span) => {
      span.textContent = previewNextInterval(entry.c, Number(span.dataset.q));
    });

    applyModeToCurrentKanji();
  }

  function renderComponentTree(entry) {
    const tree = $('componentTree');
    tree.innerHTML = '';
    let topColorIdx = 0;

    entry.parts.forEach((part, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `comp-node depth-${Math.min(3, part.depth)}`;
      const color = part.depth === 1 ? getPartColor(topColorIdx++) : 'var(--ink-secondary)';
      const posLabel = part.pos ? (POS_VI[part.pos] || part.pos) : '';
      const radTag = part.rad ? ' · Bộ thủ' : '';
      const hvLabel = part.hv ? `${part.hv}` : 'Bộ phận';
      const viLabel = part.vi ? part.vi : (part.orig ? `biến thể của ${part.orig}` : '');

      btn.innerHTML = `
        <span class="comp-left">
          <span class="comp-swatch" style="background:${color}"></span>
          <span class="comp-glyph">${part.el}</span>
          <span class="comp-info">
            <div class="comp-name">${hvLabel}${radTag}</div>
            <div class="comp-meaning">${viLabel}</div>
          </span>
        </span>
        <span class="comp-pos">${posLabel ? posLabel + ' · ' : ''}${part.strokes.length} nét</span>
      `;

      const activate = () => {
        state.activeComponentIdx = idx;
        qsa('.comp-node').forEach((n, i) => n.classList.toggle('active', i === idx));
        if (state.currentMode === 'anatomy') {
          state.anatomyStep = entry.strokes.length;
          renderAnatomySvg(-1);
        }
        renderRelatedKanji(part.el, entry.c, part.orig);
      };

      btn.addEventListener('mouseenter', () => {
        if (state.currentMode === 'anatomy') {
          state.activeComponentIdx = idx;
          renderAnatomySvg(-1);
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (state.currentMode === 'anatomy' && !btn.classList.contains('active')) {
          state.activeComponentIdx = -1;
          renderAnatomySvg(-1);
        }
      });
      btn.addEventListener('click', activate);
      tree.appendChild(btn);
    });
  }

  function renderRelatedKanji(compEl, currentChar, origEl = '') {
    const box = $('relatedChips');
    box.innerHTML = '';
    const info = state.componentsIndex[compEl] || (origEl && state.componentsIndex[origEl]);
    const labelKey = state.componentsIndex[compEl] ? compEl : origEl;

    if (!info || !info.chars.length) {
      $('relatedLabel').textContent = `Chữ Kanji cùng chứa bộ phận ${compEl}`;
      box.innerHTML = '<span class="sub-hint">Đây là bộ chữ gốc đơn lập.</span>';
      return;
    }

    const others = info.chars.filter((c) => c !== currentChar).slice(0, 24);
    $('relatedLabel').textContent = `Cùng chứa bộ ${labelKey} (${info.hv || ''}) — ${info.chars.length} chữ`;

    if (!others.length) {
      box.innerHTML = '<span class="sub-hint">Chưa có chữ khác cùng bộ trong N5–N1.</span>';
      return;
    }

    others.forEach((ch) => {
      const meta = state.kanjiLookup[ch];
      if (!meta) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'related-chip';
      chip.title = `${meta.hv} — ${meta.vi}`;
      chip.innerHTML = `
        <span class="related-chip-glyph">${ch}</span>
        <span>${meta.hv}</span>
        <span class="related-chip-lvl">N${meta.l}</span>
      `;
      chip.addEventListener('click', () => jumpToKanji(ch));
      box.appendChild(chip);
    });
  }

  // --- Left Column Search, Filter & Chunked Rendering ---
  function matchesQuery(entry, q, normQ, kanaQ) {
    if (!q) return true;
    if (entry.c === q || entry.c.includes(q)) return true;
    if (stripVietnamese(entry.hv).includes(normQ)) return true;
    if (entry.hvAll.some((h) => stripVietnamese(h).includes(normQ))) return true;
    if (entry.vi.some((v) => stripVietnamese(v).includes(normQ))) return true;
    if (entry.en.some((e) => e.toLowerCase().includes(normQ))) return true;
    if (entry.parts.some((p) => p.el === q || p.orig === q)) return true;
    if (kanaQ) {
      if (entry.on.some((o) => cleanReadingToken(o).includes(kanaQ))) return true;
      if (entry.kun.some((k) => cleanReadingToken(k).includes(kanaQ))) return true;
    }
    return false;
  }

  function applyFilterAndRender() {
    const q = state.searchQuery.trim();
    const normQ = stripVietnamese(q);
    const kanaQ = /^[a-zA-Z\u3040-\u30ff]+$/.test(q) ? romajiToHiragana(q) : '';

    if (state.globalSearch && q) {
      // Search across all 2,211 entries in kanjiLookup
      const hits = [];
      for (const [ch, meta] of Object.entries(state.kanjiLookup)) {
        const compMatch = state.componentsIndex[q]?.chars?.includes(ch);
        if (
          ch.includes(q) ||
          stripVietnamese(meta.hv).includes(normQ) ||
          stripVietnamese(meta.vi).includes(normQ) ||
          compMatch
        ) {
          hits.push({ c: ch, l: meta.l, hv: meta.hv, vi: [meta.vi], _isLookup: true });
        }
      }
      hits.sort((a, b) => b.l - a.l);
      state.filteredList = hits;
      $('listMetaText').textContent = `Tìm thấy ${hits.length} chữ trên toàn bộ N5–N1`;
      renderKanjiList('reset');
      return;
    }

    const levelList = state.levelCache[state.currentLevel] || [];
    state.filteredList = levelList.filter((entry) => {
      if (state.filterStatus !== 'all' && getKanjiStatus(entry.c) !== state.filterStatus) {
        return false;
      }
      return matchesQuery(entry, q, normQ, kanaQ);
    });

    $('listMetaText').textContent = `N${state.currentLevel}: ${state.filteredList.length} / ${levelList.length} chữ`;
    renderKanjiList('reset');
  }

  function renderKanjiList(action = 'reset') {
    const container = $('kanjiList');
    if (action === 'dots') {
      qsa('.kanji-item').forEach((btn) => {
        const dot = btn.querySelector('.kanji-item-dot');
        if (dot) {
          dot.className = `kanji-item-dot ${getKanjiStatus(btn.dataset.char)}`;
        }
      });
      return;
    }

    if (action === 'reset') {
      container.innerHTML = '';
      state.renderedCount = 0;
    }

    const oldMore = container.querySelector('.load-more-btn');
    if (oldMore) oldMore.remove();

    const slice = state.filteredList.slice(state.renderedCount, state.renderedCount + BATCH_SIZE);
    const frag = document.createDocumentFragment();

    slice.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kanji-item';
      btn.dataset.char = item.c;
      if (state.currentKanji && state.currentKanji.c === item.c) {
        btn.classList.add('active');
      }
      const status = getKanjiStatus(item.c);
      const lvlBadge = item._isLookup ? `N${item.l} · ` : '';
      btn.innerHTML = `
        <span class="kanji-item-glyph">${item.c}</span>
        <span class="kanji-item-body">
          <div class="kanji-item-hv">${lvlBadge}${item.hv}</div>
          <div class="kanji-item-vi">${item.vi[0] || ''}</div>
        </span>
        <span class="kanji-item-dot ${status}" title="${status}"></span>
      `;
      btn.addEventListener('click', () => (item._isLookup ? jumpToKanji(item.c) : selectKanji(item)));
      frag.appendChild(btn);
    });

    container.appendChild(frag);
    state.renderedCount += slice.length;

    if (state.renderedCount < state.filteredList.length) {
      const remaining = state.filteredList.length - state.renderedCount;
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'load-more-btn';
      moreBtn.textContent = `Tải thêm ${Math.min(BATCH_SIZE, remaining)} chữ nữa (còn ${remaining})`;
      moreBtn.addEventListener('click', () => renderKanjiList('append'));
      container.appendChild(moreBtn);
    }
  }

  async function selectLevel(level, pickFirst = true) {
    state.currentLevel = level;
    qsa('.level-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.level) === level));
    const list = await loadLevel(level);
    applyFilterAndRender();
    if (pickFirst && list.length) {
      const target = state.filteredList.find((x) => !x._isLookup) || list[0];
      selectKanji(target);
    }
  }

  // --- Mode 4: Active Recall Typing Check ---
  function handleTypingSubmit(e) {
    e.preventDefault();
    const entry = state.currentKanji;
    if (!entry) return;

    const hvInput = stripVietnamese($('inputHanViet').value).trim();
    const readInputRaw = $('inputReading').value.trim();
    const readKana = cleanReadingToken(
      /^[a-zA-Z\s'-]+$/.test(readInputRaw) ? romajiToHiragana(readInputRaw) : readInputRaw
    );

    const validHvs = [stripVietnamese(entry.hv), ...entry.hvAll.map(stripVietnamese)].filter(Boolean);
    const hvOk = hvInput.length > 0 && validHvs.includes(hvInput);

    const validReadings = [...entry.on, ...entry.kun].map(cleanReadingToken).filter(Boolean);
    const readOk = readKana.length > 0 && validReadings.some((r) => r === readKana || r.startsWith(readKana));

    const resEl = $('typingResult');
    resEl.classList.remove('hidden', 'ok', 'warn');

    if (hvOk && readOk) {
      playWoodTap(true);
      resEl.classList.add('ok');
      resEl.textContent = `Chính xác! ${entry.c} — ${entry.hv} | On: ${entry.on.join(', ') || '—'} | Kun: ${entry.kun.join(', ') || '—'}`;
    } else {
      playWoodTap(false);
      resEl.classList.add('warn');
      const parts = [];
      if (!hvOk) parts.push(`Âm Hán-Việt chưa đúng (đáp án: ${entry.hv})`);
      if (!readOk) parts.push(`Cách đọc Kana chưa khớp (${readKana || 'trống'})`);
      resEl.textContent = parts.join('. ') + '. Hãy tự kiểm lại rồi gõ lại.';
    }
  }

  // --- View Switching ---
  function switchView(view) {
    state.currentView = view;
    qsa('.view-btn').forEach((b) => {
      const active = b.dataset.view === view;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });

    $('viewAtelier').classList.toggle('hidden', view !== 'atelier');
    $('viewDojo').classList.toggle('hidden', view !== 'dojo');
    $('viewNeuro').classList.toggle('hidden', view !== 'neuro');

    if (view === 'neuro') {
      renderNeuroDashboard();
      refreshGitStatus();
    }
  }

  // --- Blind Recall Dojo ---
  async function startDojoQueue() {
    const scope = $('dojoScopeSelect').value;
    let chars = [];

    if (scope === 'due') {
      chars = getDueKanjiChars();
      if (!chars.length) {
        $('dojoEmptyState').classList.remove('hidden');
        $('dojoCard').classList.add('hidden');
        $('dojoEmptyState').innerHTML = '<p>Hôm nay bạn không có chữ nào đến hạn ôn SRS. Hãy chọn <strong>"Chữ chưa thuộc ở cấp đang chọn"</strong> hoặc luyện thêm chữ mới ở Xưởng chữ.</p>';
        return;
      }
    } else {
      const list = await loadLevel(state.currentLevel);
      chars = list.filter((k) => getKanjiStatus(k.c) !== 'mastered').slice(0, 15).map((k) => k.c);
    }

    // Load required levels
    const neededLevels = new Set(chars.map((c) => state.kanjiLookup[c]?.l).filter(Boolean));
    await Promise.all([...neededLevels].map((l) => loadLevel(l)));

    const entries = [];
    for (const ch of chars) {
      const lvl = state.kanjiLookup[ch]?.l;
      const list = state.levelCache[lvl] || [];
      const found = list.find((k) => k.c === ch);
      if (found) entries.push(found);
    }

    state.dojoQueue = entries;
    state.dojoIndex = 0;
    if (!entries.length) {
      $('dojoEmptyState').classList.remove('hidden');
      $('dojoCard').classList.add('hidden');
      return;
    }
    $('dojoEmptyState').classList.add('hidden');
    $('dojoCard').classList.remove('hidden');
    showDojoCard();
  }

  function showDojoCard() {
    const entry = state.dojoQueue[state.dojoIndex];
    if (!entry) {
      $('dojoEmptyState').classList.remove('hidden');
      $('dojoCard').classList.add('hidden');
      $('dojoEmptyState').innerHTML = '<p>Bạn đã hoàn thành toàn bộ lượt ôn tập mù này. Tiến độ đã được lưu vào <code>data/user-progress.json</code>.</p>';
      return;
    }

    state.dojoCurrent = entry;
    $('dojoProgressText').textContent = `Thẻ ${state.dojoIndex + 1} / ${state.dojoQueue.length}`;
    $('dojoLevelTag').textContent = `JLPT N${entry.l} · ${entry.s} nét`;
    $('dojoHv').textContent = entry.hv;
    $('dojoVi').textContent = entry.vi.slice(0, 4).join(' · ') || entry.en.slice(0, 3).join(' · ');
    $('dojoReadings').textContent = `On: ${entry.on.join(', ') || '—'}   |   Kun: ${entry.kun.join(', ') || '—'}`;
    const note = state.progress.kanji[entry.c]?.note;
    $('dojoMnemonicPreview').textContent = note ? `Ghi chú chiết tự của bạn: ${note}` : 'Chưa có ghi chú chiết tự cá nhân cho chữ này.';
    $('dojoFeedback').textContent = 'Tự hình dung hình dáng chữ trong đầu và viết nét đầu tiên.';
    $('dojoFeedback').className = 'board-feedback';

    dojoController.setKanji(entry, { hideAll: true, showGhost: false });

    clearInterval(state.dojoFrictionTimer);
    const btn = $('dojoHintBtn');
    let secs = 3;
    btn.disabled = true;
    btn.textContent = `Gợi ý 1 nét (${secs}s)`;
    state.dojoFrictionTimer = setInterval(() => {
      secs -= 1;
      if (secs <= 0) {
        clearInterval(state.dojoFrictionTimer);
        btn.disabled = false;
        btn.textContent = 'Gợi ý 1 nét';
      } else {
        btn.textContent = `Gợi ý 1 nét (${secs}s)`;
      }
    }, 1000);
  }

  // --- Detox Breathing Gate & Monk Focus Timer ---
  function formatMMSS(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startFocusTimerCore() {
    const mins = Number($('focusDurationSelect').value) || 15;
    state.focusRunning = true;
    state.focusRemainingSec = mins * 60;
    state.focusElapsedInSession = 0;
    document.body.classList.add('monk-mode');
    $('focusWidget').classList.add('running');
    $('focusTimerText').textContent = `Đang tập trung ${formatMMSS(state.focusRemainingSec)}`;

    clearInterval(state.focusInterval);
    state.focusInterval = setInterval(() => {
      if (document.hidden) return;
      state.focusRemainingSec -= 1;
      state.focusElapsedInSession += 1;
      state.progress.stats.totalFocusSeconds += 1;
      if (state.focusElapsedInSession > state.progress.stats.longestCleanSessionSec) {
        state.progress.stats.longestCleanSessionSec = state.focusElapsedInSession;
      }
      $('focusTimerText').textContent = `Đang tập trung ${formatMMSS(state.focusRemainingSec)}`;

      if (state.focusElapsedInSession % 30 === 0) scheduleSaveProgress();

      if (state.focusRemainingSec <= 0) {
        stopFocusSession(true);
      }
    }, 1000);
  }

  function stopFocusSession(completed = false) {
    clearInterval(state.focusInterval);
    state.focusRunning = false;
    document.body.classList.remove('monk-mode');
    $('focusWidget').classList.remove('running');
    const mins = Number($('focusDurationSelect').value) || 15;
    $('focusTimerText').textContent = `Tập trung ${mins}:00`;

    if (completed) {
      state.progress.stats.completedSessions += 1;
      state.progress.sessionLogs.push({
        endedAt: new Date().toISOString(),
        durationSec: state.focusElapsedInSession,
      });
      playWoodTap(true);
      $('focusBannerText').textContent = `Chúc mừng! Bạn vừa hoàn thành ${Math.round(state.focusElapsedInSession / 60)} phút tập trung sâu không phân tâm.`;
      $('focusBanner').classList.remove('hidden');
    }
    scheduleSaveProgress(true);
  }

  function openDetoxGate() {
    if (state.detoxSkipToday || !state.progress.settings.requireDetoxGate) {
      startFocusTimerCore();
      return;
    }
    const overlay = $('detoxOverlay');
    const circle = $('detoxCircle');
    const phaseEl = $('detoxPhaseText');
    const countEl = $('detoxCountdown');
    overlay.classList.remove('hidden');

    let sec = 12;
    const updatePhase = (s) => {
      const mod = (12 - s) % 12;
      circle.classList.remove('inhale', 'hold', 'exhale');
      if (mod < 4) {
        circle.classList.add('inhale');
        phaseEl.textContent = 'Hít vào';
      } else if (mod < 8) {
        circle.classList.add('hold');
        phaseEl.textContent = 'Giữ nhịp';
      } else {
        circle.classList.add('exhale');
        phaseEl.textContent = 'Thở ra';
      }
      countEl.textContent = `${s}s`;
    };

    updatePhase(sec);
    clearInterval(state.detoxInterval);
    state.detoxInterval = setInterval(() => {
      sec -= 1;
      if (sec <= 0) {
        clearInterval(state.detoxInterval);
        overlay.classList.add('hidden');
        startFocusTimerCore();
      } else {
        updatePhase(sec);
      }
    }, 1000);
  }

  // --- Neuro-Stats & Git Sync ---
  function renderNeuroDashboard() {
    const s = state.progress.stats;
    $('statTotalFocus').textContent = `${Math.round((s.totalFocusSeconds || 0) / 60)} phút`;
    $('statSessionsCount').textContent = `${s.completedSessions || 0} phiên hoàn tất`;
    $('statLongestSession').textContent = `${Math.round((s.longestCleanSessionSec || 0) / 60)} phút`;
    $('statTabSwitches').textContent = `${s.tabSwitchCount || 0} lần chuyển tab gây nhiễu`;

    const blindTot = s.blindRecallTotalCount || 0;
    const blindAcc = blindTot ? `${Math.round((s.blindRecallSuccessCount / blindTot) * 100)}%` : '—';
    $('statBlindAccuracy').textContent = blindAcc;
    $('statTotalStrokes').textContent = `${s.totalStrokesDrawn || 0} nét chữ đã rèn`;

    const countsByLvl = {
      5: { mastered: 0, learning: 0, total: LEVEL_COUNTS[5] },
      4: { mastered: 0, learning: 0, total: LEVEL_COUNTS[4] },
      3: { mastered: 0, learning: 0, total: LEVEL_COUNTS[3] },
      2: { mastered: 0, learning: 0, total: LEVEL_COUNTS[2] },
      1: { mastered: 0, learning: 0, total: LEVEL_COUNTS[1] },
    };

    let masteredSum = 0;
    for (const [ch] of Object.entries(state.progress.kanji)) {
      const lvl = state.kanjiLookup[ch]?.l;
      if (!lvl) continue;
      const st = getKanjiStatus(ch);
      if (st === 'mastered') {
        countsByLvl[lvl].mastered += 1;
        masteredSum += 1;
      } else if (st === 'learning' || st === 'due') {
        countsByLvl[lvl].learning += 1;
      }
    }

    $('statMasteredTotal').textContent = `${masteredSum} / 2211`;
    $('statDueToday').textContent = `${getDueKanjiChars().length} chữ cần ôn hôm nay`;

    const bars = $('jlptProgressBars');
    bars.innerHTML = '';
    LEVEL_LIST.forEach((lvl) => {
      const c = countsByLvl[lvl];
      const mPct = ((c.mastered / c.total) * 100).toFixed(1);
      const lPct = ((c.learning / c.total) * 100).toFixed(1);
      const row = document.createElement('div');
      row.className = 'jlpt-bar-row';
      row.innerHTML = `
        <div class="jlpt-bar-head">
          <strong>JLPT N${lvl}</strong>
          <span class="mono">${c.mastered} thuộc sâu · ${c.learning} đang luyện / ${c.total}</span>
        </div>
        <div class="jlpt-bar-track">
          <div class="bar-mastered" style="width:${mPct}%"></div>
          <div class="bar-learning" style="width:${lPct}%"></div>
        </div>
      `;
      bars.appendChild(row);
    });
  }

  async function refreshGitStatus() {
    const box = $('gitStatusBox');
    if (!state.hasServerApi) {
      box.textContent = 'Đang chạy ở chế độ tĩnh (không có Node server). Bạn có thể tải file user-progress.json bên dưới để commit lên GitHub thủ công.';
      return;
    }
    try {
      const res = await fetch('/api/git-status', { cache: 'no-store' });
      const st = await res.json();
      if (!st.isGitRepo) {
        box.textContent = [
          'Thư mục này chưa khởi tạo Git (.git).',
          'Để đồng bộ qua GitHub dùng cho nhiều máy, mở Terminal tại thư mục dự án và chạy:',
          '  git init',
          '  git add .',
          '  git commit -m "init bokuseki"',
          '  git remote add origin <URL-repo-GitHub-của-bạn>',
          '  git push -u origin main',
        ].join('\n');
        return;
      }
      box.textContent = [
        `Nhánh hiện tại: ${st.branch || '(detached)'}`,
        `Remote origin: ${st.hasRemote ? st.remoteUrl : 'Chưa gắn remote GitHub'}`,
        `Commit gần nhất: ${st.lastCommit}`,
        `File tiến độ (data/user-progress.json): ${st.progressDirty ? 'Có thay đổi mới chưa commit' : 'Đã đồng bộ với commit mới nhất'}`,
      ].join('\n');
    } catch (err) {
      box.textContent = `Không thể kiểm tra Git: ${err.message}`;
    }
  }

  async function handleGitAction(push) {
    const box = $('gitStatusBox');
    box.textContent = push ? 'Đang commit & push tiến độ lên GitHub...' : 'Đang commit data/user-progress.json...';
    try {
      const res = await fetch('/api/git-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ push }),
      });
      const out = await res.json();
      if (!out.ok) {
        box.textContent = `Thông báo Git: ${out.error}`;
      } else {
        await refreshGitStatus();
        box.textContent += `\n\nThành công: ${out.pushed ? 'Đã commit và push lên GitHub!' : out.committed ? 'Đã commit vào Git nội bộ.' : 'Không có thay đổi mới để commit.'}`;
      }
    } catch (err) {
      box.textContent = `Lỗi kết nối server: ${err.message}`;
    }
  }

  // --- Theme & Sound ---
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('themeToggleBtn').textContent = theme === 'yoru' ? 'Giấy sáng' : 'Đêm';
    state.progress.settings.theme = theme;
    if (state.currentMode === 'anatomy' && state.currentKanji) {
      renderAnatomySvg(-1);
    }
  }

  function applySoundSetting(enabled) {
    state.progress.settings.soundEnabled = enabled;
    const btn = $('soundToggleBtn');
    btn.textContent = enabled ? 'Âm mộc: Bật' : 'Âm mộc: Tắt';
    btn.setAttribute('aria-pressed', String(enabled));
  }

  // --- Event Binding ---
  function bindEvents() {
    qsa('.level-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectLevel(Number(btn.dataset.level), true));
    });

    qsa('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    qsa('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    qsa('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filterStatus = btn.dataset.filter;
        qsa('.filter-chip').forEach((c) => c.classList.toggle('active', c === btn));
        applyFilterAndRender();
      });
    });

    $('searchInput').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      applyFilterAndRender();
    });

    $('globalSearchToggle').addEventListener('change', (e) => {
      state.globalSearch = e.target.checked;
      applyFilterAndRender();
    });

    $('prevKanjiBtn').addEventListener('click', () => navigateKanji(-1));
    $('nextKanjiBtn').addEventListener('click', () => navigateKanji(1));
    $('speakKanjiBtn').addEventListener('click', () => speakJapanese(state.currentKanji));

    // Anatomy controls
    $('playAnimBtn').addEventListener('click', playStrokeAnimation);
    $('stepBackBtn').addEventListener('click', () => {
      stopStrokeAnimation();
      if (!state.currentKanji) return;
      state.anatomyStep = Math.max(1, Math.min(state.anatomyStep, state.currentKanji.strokes.length) - 1);
      renderAnatomySvg(-1);
    });
    $('stepFwdBtn').addEventListener('click', () => {
      stopStrokeAnimation();
      if (!state.currentKanji) return;
      state.anatomyStep = Math.min(state.currentKanji.strokes.length, state.anatomyStep + 1);
      renderAnatomySvg(state.anatomyStep - 1);
    });
    $('showAllStrokesBtn').addEventListener('click', () => {
      stopStrokeAnimation();
      if (!state.currentKanji) return;
      state.anatomyStep = state.currentKanji.strokes.length;
      state.activeComponentIdx = -1;
      qsa('.comp-node').forEach((n) => n.classList.remove('active'));
      renderAnatomySvg(-1);
    });
    $('colorPartsToggle').addEventListener('change', () => renderAnatomySvg(-1));
    $('strokeNumberToggle').addEventListener('change', () => renderAnatomySvg(-1));

    // Guided controls
    $('undoStrokeBtn').addEventListener('click', () => atelierController.undo());
    $('clearCanvasBtn').addEventListener('click', () => atelierController.clear());
    $('peekNextStrokeBtn').addEventListener('click', () => atelierController.peekNext());
    $('ghostGuideToggle').addEventListener('change', (e) => atelierController.setGhost(e.target.checked));

    // Blind controls
    $('blindUndoBtn').addEventListener('click', () => atelierController.undo());
    $('blindClearBtn').addEventListener('click', () => atelierController.clear());
    $('blindHintBtn').addEventListener('click', () => atelierController.peekNext());
    $('blindRevealBtn').addEventListener('click', () => {
      if (!state.currentKanji) return;
      $('promptKanjiGlyph').textContent = state.currentKanji.c;
      $('promptKanjiGlyph').classList.remove('masked');
      atelierController.revealAnswer();
    });

    // Typing mode
    $('inputReading').addEventListener('input', (e) => {
      const val = e.target.value;
      $('kanaPreviewBadge').textContent = /^[a-zA-Z\s'-]+$/.test(val) ? romajiToHiragana(val) : val;
    });
    $('typingForm').addEventListener('submit', handleTypingSubmit);
    $('typingHintBtn').addEventListener('click', () => {
      if (!state.currentKanji) return;
      const e = state.currentKanji;
      const resEl = $('typingResult');
      resEl.classList.remove('hidden', 'ok', 'warn');
      resEl.textContent = `Gợi ý: Hán-Việt "${e.hv}", On "${e.on[0] || '—'}", Kun "${e.kun[0] || '—'}"`;
    });

    // Mnemonic note auto-save
    $('mnemonicNoteInput').addEventListener('input', (e) => {
      if (!state.currentKanji) return;
      const ch = state.currentKanji.c;
      const prev = state.progress.kanji[ch] || { reps: 0, interval: 0, ease: 2.5, writePasses: 0, blindPasses: 0 };
      prev.note = e.target.value;
      state.progress.kanji[ch] = prev;
      $('noteSaveHint').textContent = 'Đang lưu...';
      clearTimeout(state.noteTimer);
      state.noteTimer = setTimeout(() => {
        scheduleSaveProgress(true);
        $('noteSaveHint').textContent = 'Đã lưu vào ổ đĩa';
      }, 450);
    });

    // SRS Grade buttons (Atelier)
    qsa('.srs-btn[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!state.currentKanji) return;
        recordSrsGrade(state.currentKanji.c, Number(btn.dataset.quality));
        renderKanjiList('dots');
        navigateKanji(1);
      });
    });

    // Dojo
    $('dojoStartBtn').addEventListener('click', startDojoQueue);
    $('dojoUndoBtn').addEventListener('click', () => dojoController.undo());
    $('dojoClearBtn').addEventListener('click', () => dojoController.clear());
    $('dojoHintBtn').addEventListener('click', () => dojoController.peekNext());
    $('dojoRevealBtn').addEventListener('click', () => {
      if (!state.dojoCurrent) return;
      dojoController.revealAnswer();
      $('dojoFeedback').textContent = `Đáp án: ${state.dojoCurrent.c} (${state.dojoCurrent.hv}) — ${state.dojoCurrent.s} nét. Hãy tự đánh giá mức độ nhớ bên dưới.`;
      $('dojoFeedback').className = 'board-feedback';
    });
    qsa('[data-dojo-q]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!state.dojoCurrent) return;
        recordSrsGrade(state.dojoCurrent.c, Number(btn.dataset.dojoQ));
        state.dojoIndex += 1;
        showDojoCard();
      });
    });

    // Focus timer & Detox gate
    $('focusDurationSelect').addEventListener('change', (e) => {
      const m = Number(e.target.value) || 15;
      state.progress.settings.focusDurationMin = m;
      if (!state.focusRunning) {
        $('focusTimerText').textContent = `Tập trung ${m}:00`;
      }
      scheduleSaveProgress();
    });

    $('focusStartBtn').addEventListener('click', () => {
      if (state.focusRunning) {
        stopFocusSession(false);
      } else {
        openDetoxGate();
      }
    });

    $('detoxCompleteBtn').addEventListener('click', () => {
      clearInterval(state.detoxInterval);
      $('detoxOverlay').classList.add('hidden');
      startFocusTimerCore();
    });

    $('detoxSkipBtn').addEventListener('click', () => {
      clearInterval(state.detoxInterval);
      state.detoxSkipToday = true;
      $('detoxOverlay').classList.add('hidden');
      startFocusTimerCore();
    });

    $('focusBannerClose').addEventListener('click', () => {
      $('focusBanner').classList.add('hidden');
    });

    // Distraction detection during Focus Session
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.focusRunning) {
        state.progress.stats.tabSwitchCount = (state.progress.stats.tabSwitchCount || 0) + 1;
        scheduleSaveProgress();
      } else if (!document.hidden && state.focusRunning) {
        $('focusBannerText').textContent = `Bạn vừa rời tab trong lúc đang tập trung (tổng ${state.progress.stats.tabSwitchCount} lần). Hãy hít thở sâu và quay lại nét bút.`;
        $('focusBanner').classList.remove('hidden');
      }
    });

    // Theme & Sound
    $('themeToggleBtn').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'yoru' ? 'hanshi' : 'yoru';
      applyTheme(next);
      scheduleSaveProgress();
    });

    $('soundToggleBtn').addEventListener('click', () => {
      applySoundSetting(!state.progress.settings.soundEnabled);
      scheduleSaveProgress();
    });

    // Git & JSON backup
    $('gitCommitBtn').addEventListener('click', () => handleGitAction(false));
    $('gitPushBtn').addEventListener('click', () => handleGitAction(true));
    $('refreshGitBtn').addEventListener('click', refreshGitStatus);

    $('exportJsonBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'user-progress.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $('importJsonInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        state.progress = { ...createDefaultProgress(), ...parsed };
        scheduleSaveProgress(true);
        updateDueBadge();
        renderNeuroDashboard();
        if (state.currentKanji) selectKanji(state.currentKanji);
        $('gitStatusBox').textContent = 'Đã nhập tiến độ từ file JSON thành công.';
      } catch (err) {
        $('gitStatusBox').textContent = `File JSON không hợp lệ: ${err.message}`;
      }
      e.target.value = '';
    });

    // Keyboard shortcuts [ and ] to move between Kanji when not typing
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === '[') navigateKanji(-1);
      if (e.key === ']') navigateKanji(1);
    });
  }

  function navigateKanji(delta) {
    const list = state.filteredList.filter((x) => !x._isLookup);
    if (!list.length || !state.currentKanji) return;
    const idx = list.findIndex((x) => x.c === state.currentKanji.c);
    const nextIdx = Math.max(0, Math.min(list.length - 1, (idx === -1 ? 0 : idx) + delta));
    selectKanji(list[nextIdx]);
  }

  // --- Bootstrap ---
  async function init() {
    bindEvents();
    await Promise.all([loadProgress(), ensureMetaIndexes()]);
    applyTheme(state.progress.settings.theme || 'hanshi');
    applySoundSetting(Boolean(state.progress.settings.soundEnabled));
    const defMin = state.progress.settings.focusDurationMin || 15;
    $('focusDurationSelect').value = String(defMin);
    $('focusTimerText').textContent = `Tập trung ${defMin}:00`;
    updateDueBadge();
    await selectLevel(state.progress.settings.defaultLevel || 5, true);
  }

  init().catch((err) => {
    console.error('Init failed:', err);
    $('boardFeedback').textContent = `Lỗi khởi tạo ứng dụng: ${err.message}`;
    $('boardFeedback').className = 'board-feedback warn';
  });
})();
