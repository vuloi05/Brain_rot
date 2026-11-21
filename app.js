(() => {
  'use strict';

  const STORAGE_KEY = 'bokuseki_progress_v1';
  const BATCH_SIZE = 120;
  const LEVEL_LIST = [5, 4, 3, 2, 1];
  const LEVEL_COUNTS = { 5: 80, 4: 168, 3: 371, 2: 367, 1: 1244 };
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
    textbookLoaded: false,
    textbookData: null,
    atelierTextbookFilter: '', // '' | 'all' | '1'..'10'
    currentSpace: 'home', // 'home' | 'jp' | 'en'
    currentLevel: 5,
    currentView: 'atelier', // 'atelier' | 'reader' | 'exams' | 'dojo' | 'neuro'
    currentMode: 'anatomy', // 'anatomy' | 'guided' | 'blind' | 'typing'
    currentKanji: null,
    filteredList: [],
    renderedCount: 0,
    filterStatus: 'today',
    sessionFailedSet: new Set(),
    forecastMode: 'all', // 'all' | 'jp' | 'en'
    rosterMode: 'jp',     // 'jp' | 'en'
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
    dojoMode: 'write', // 'write' | 'typing'
    dojoQueue: [],
    dojoIndex: 0,
    dojoCurrent: null,
    dojoResults: [],
    dojoFrictionTimer: null,
    // Module 3: Deep Reader
    readingsLoaded: false,
    readings: [],
    vocabDict: {},
    readerFilter: 'all',
    currentReading: null,
    readerUnlockedIdx: 0,
    readerAllUnlocked: false,
    readerParaShowAll: {},
    readerSelectedKanji: '',
    readerSelectedWord: '',
    readerLookupTimer: null,
    readerLookupSeq: 0,
    readerQuestionTimers: [],
    // Exam Studio & Textbooks (de_thi/ & tai_lieu_tieng_nhat/)
    examsLoaded: false,
    examCatalog: [],
    examMode: 'exams', // 'exams' | 'textbook'
    activeTextbookId: 'chukyu', // 'chukyu' | 'mimi-n3'
    mimiBookLoaded: false,
    mimiBookData: null,
    mimiStepFilter: 'all', // 'all' | '1' | '2' | '3'
    currentMimiItem: null,
    examFilter: 'all',
    examSearch: '',
    currentExam: null,
    currentTextbookLesson: null,
    tbInteractiveOpen: false,
    examNoteTimer: null,
    // Module 4: Sentence Forge & Blind Dictation
    sentencesLoaded: false,
    sentences: [],
    forgeMode: 'forge', // 'forge' | 'dictation'
    forgeFilter: 'all',
    currentSentence: null,
    forgeSlots: [null, null, null, null],
    forgeShuffled: [],
    forgeHintTimer: null,
    dictHintTimer: null,
    forgeSelectedKanji: '',
    dictRevealed: false,
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
        enLevel: 'A1',
        enGlobal10k: false,
        enStatusFilter: 'today',
        enRootFilter: '',
        enLastWord: '',
        jpDailyNewLimit: 10,
        jpDailyNewDate: '',
        jpDailyNewCount: 0,
        enDailyNewLimit: 10,
        enDailyNewDate: '',
        enDailyNewCount: 0,
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

  // --- DOM Helpers ---
  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

  function encodeUrlPath(pathStr) {
    return (pathStr || '').split('/').map((seg) => encodeURIComponent(seg)).join('/');
  }

  function speakJapaneseText(raw, rate = 0.86) {
    if (!raw || !('speechSynthesis' in window)) return;
    const utt = new SpeechSynthesisUtterance(raw);
    utt.lang = 'ja-JP';
    utt.rate = rate;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  }

  function speakJapanese(entry) {
    if (!entry) return;
    const raw = (entry.kun[0] || entry.on[0] || entry.c).replace(/[-.]/g, '');
    speakJapaneseText(raw, 0.85);
  }

  // --- Persistence (Local Disk via server.js + localStorage fallback) ---
  function setSaveBadge(text, unsaved = false) {
    const badge = $('saveStatusBadge');
    if (!badge) return;
    badge.title = text;
    if (text.startsWith('Đã lưu')) {
      badge.textContent = '✓ Đã lưu';
    } else if (text.includes('LocalStorage')) {
      badge.textContent = '✓ Cục bộ';
    } else {
      badge.textContent = text;
    }
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
        enVocab: loaded.enVocab || {},
        readingsDone: loaded.readingsDone || {},
        customReadings: loaded.customReadings || [],
        enReadingsDone: (loaded.enReadingsDone && typeof loaded.enReadingsDone === 'object' && !Array.isArray(loaded.enReadingsDone)) ? loaded.enReadingsDone : {},
        enReadingNotes: (loaded.enReadingNotes && typeof loaded.enReadingNotes === 'object' && !Array.isArray(loaded.enReadingNotes)) ? loaded.enReadingNotes : {},
        enCustomReadings: Array.isArray(loaded.enCustomReadings) ? loaded.enCustomReadings : [],
        sentencesDone: loaded.sentencesDone || {},
        examNotes: loaded.examNotes || {},
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

  // --- SRS Logic (SM-2 adapted, shared across JP & EN) ---
  function computeSrsStatus(rec) {
    if (!rec) return 'new';
    if (rec.due && new Date(rec.due).getTime() <= Date.now()) return 'due';
    if (!rec.reps && !rec.writePasses && !rec.blindPasses) return 'new';
    if ((rec.interval || 0) >= 7) return 'mastered';
    return 'learning';
  }

  function previewSrsRecord(recInput, quality) {
    const rec = recInput || { reps: 0, interval: 0, ease: 2.5 };
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

  function applySrsGradeToRecord(prevInput, quality) {
    const prev = prevInput || {
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
    return {
      ...prev,
      reps,
      interval,
      ease: Number(ease.toFixed(2)),
      due: new Date(dueMs).toISOString(),
      lastReviewedAt: new Date().toISOString(),
    };
  }

  function getKanjiStatus(ch) {
    return computeSrsStatus(state.progress.kanji[ch]);
  }

  function previewNextInterval(ch, quality) {
    return previewSrsRecord(state.progress.kanji[ch], quality);
  }

  function recordSrsGrade(ch, quality) {
    state.progress.kanji[ch] = applySrsGradeToRecord(state.progress.kanji[ch], quality);
    scheduleSaveProgress(true);
    updateDueBadge();
  }

  function getDueKeysFromMap(mapObj) {
    const now = Date.now();
    return Object.entries(mapObj || {})
      .filter(([, rec]) => rec && rec.due && new Date(rec.due).getTime() <= now)
      .sort((a, b) => new Date(a[1].due) - new Date(b[1].due))
      .map(([k]) => k);
  }

  function getDueKanjiChars() {
    return getDueKeysFromMap(state.progress.kanji);
  }

  function getDueEnWords() {
    return getDueKeysFromMap(state.progress.enVocab);
  }

  function getLocalDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function updateDueBadge() {
    const todayStr = getLocalDateKey();
    const s = state.progress.settings;
    if (s) {
      if (!s.jpDailyNewLimit) s.jpDailyNewLimit = 10;
      if (s.jpDailyNewDate !== todayStr) {
        s.jpDailyNewDate = todayStr;
        s.jpDailyNewCount = 0;
      }
    }

    const jpDue = getDueKanjiChars().length;
    const jpRemainingNew = Math.max(0, (s?.jpDailyNewLimit || 10) - (s?.jpDailyNewCount || 0));
    const jpTodayCount = jpDue + jpRemainingNew + state.sessionFailedSet.size;

    $('dueCountBadge').textContent = String(jpDue);
    if ($('jpTodayBadge')) $('jpTodayBadge').textContent = String(jpTodayCount);
    if ($('jpDailyLimitSelect') && s?.jpDailyNewLimit) {
      $('jpDailyLimitSelect').value = String(s.jpDailyNewLimit);
    }

    const enDue = getDueEnWords().length;
    if ($('enDueCountBadge')) $('enDueCountBadge').textContent = String(enDue);
    if (window.EnAtelierApp?.updateTodayBadge) {
      window.EnAtelierApp.updateTodayBadge();
    }
    if (state.currentSpace === 'home') renderHomeHub();
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

    const dynCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    Object.values(state.kanjiLookup).forEach((m) => {
      if (dynCounts[m.l] !== undefined) dynCounts[m.l] += 1;
    });
    LEVEL_LIST.forEach((lvl) => {
      LEVEL_COUNTS[lvl] = dynCounts[lvl];
      const badge = document.querySelector(`#jpLevelTabs .level-btn[data-level="${lvl}"] .lvl-count`);
      if (badge) badge.textContent = String(dynCounts[lvl]);
    });
  }

  async function ensureTextbookLoaded() {
    if (state.textbookLoaded) return state.textbookData;
    try {
      const res = await fetch('data/textbooks.json');
      if (res.ok) {
        state.textbookData = await res.json();
        const sel = $('atelierTextbookSelect');
        if (sel && sel.options.length <= 1 && state.textbookData?.lessons) {
          const allOpt = document.createElement('option');
          allOpt.value = 'all';
          allOpt.textContent = `中級へ行こう — Tất cả (${state.textbookData.allKanji.length} chữ)`;
          sel.appendChild(allOpt);
          state.textbookData.lessons.forEach((ls) => {
            const opt = document.createElement('option');
            opt.value = String(ls.lessonNum);
            opt.textContent = `中級へ行こう · Bài ${ls.lessonNum}: ${ls.titleJp} (${ls.kanjiChars.length} chữ)`;
            sel.appendChild(opt);
          });
        }
      }
    } catch (_) {
      state.textbookData = null;
    }
    state.textbookLoaded = true;
    return state.textbookData;
  }

  async function ensureMimiBookLoaded() {
    if (state.mimiBookLoaded) return state.mimiBookData;
    try {
      const res = await fetch('data/mimi-n3-book.json');
      if (res.ok) {
        state.mimiBookData = await res.json();
      }
    } catch (_) {
      state.mimiBookData = null;
    }
    state.mimiBookLoaded = true;
    return state.mimiBookData;
  }

  async function jumpToKanji(ch) {
    const info = state.kanjiLookup[ch];
    if (!info) return;
    if (state.atelierTextbookFilter) {
      state.atelierTextbookFilter = '';
      if ($('atelierTextbookSelect')) $('atelierTextbookSelect').value = '';
    }
    if (info.l !== state.currentLevel) {
      await selectLevel(info.l, false);
    } else {
      applyFilterAndRender();
    }
    const list = await loadLevel(info.l);
    const found = list.find((k) => k.c === ch);
    if (found) {
      selectKanji(found);
      if (state.currentSpace !== 'jp') {
        switchAppSpace('jp', 'atelier');
      } else if (state.currentView !== 'atelier') {
        switchView('atelier');
      }
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
      suggestJpSrsGrade(clean ? 3 : 2);
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

  function suggestJpSrsGrade(quality) {
    qsa('#viewAtelier .srs-btn[data-quality]').forEach((b) => {
      b.classList.toggle('srs-suggested', Number(b.dataset.quality) === quality);
    });
  }

  // --- Mode Switching ---
  function setMode(mode) {
    stopStrokeAnimation();
    state.currentMode = mode;
    qsa('#viewAtelier .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    qsa('.control-group').forEach((g) => g.classList.toggle('hidden', g.dataset.forMode !== mode));

    const isBoardMode = mode === 'anatomy' || mode === 'guided' || mode === 'blind';
    const isTyping = mode === 'typing';
    const isRef = mode === 'reference';

    $('boardStage')?.classList.toggle('anatomy-split', mode === 'anatomy');
    $('jpBoardMainCol')?.classList.toggle('hidden', !isBoardMode);
    $('jpAnatomySidePane')?.classList.toggle('hidden', mode !== 'anatomy');
    $('masumeFrame')?.classList.toggle('hidden', !isBoardMode);
    $('boardControls')?.classList.toggle('hidden', !isBoardMode);
    $('boardFeedback')?.classList.toggle('hidden', !isBoardMode);
    $('typingStage')?.classList.toggle('hidden', !isTyping);
    $('jpReferenceStage')?.classList.toggle('hidden', !isRef);

    const stepBtn = $('jpNextStepBtn');
    const stepBar = $('jpStepFlowBar');
    if (stepBar && stepBtn) {
      if (mode === 'anatomy') {
        stepBar.classList.remove('hidden');
        stepBtn.textContent = 'Bước tiếp: 2. Tập viết →';
        stepBtn.dataset.nextmode = 'guided';
      } else if (mode === 'guided') {
        stepBar.classList.remove('hidden');
        stepBtn.textContent = 'Bước tiếp: 3. Viết mù →';
        stepBtn.dataset.nextmode = 'blind';
      } else if (mode === 'blind') {
        stepBar.classList.remove('hidden');
        stepBtn.textContent = 'Bước tiếp: 4. Gõ truy xuất →';
        stepBtn.dataset.nextmode = 'typing';
      } else {
        stepBar.classList.add('hidden');
      }
    }

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
      feedback.textContent = 'Di chuột lên bộ phận bên cạnh để soi vị trí nét, hoặc bấm "Phát hoạt ảnh".';
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
    qsa('#viewAtelier .srs-btn').forEach((b) => b.classList.remove('srs-suggested'));

    // Update active state in left list
    qsa('#kanjiList .kanji-item').forEach((el) => {
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

    qsa('#viewAtelier .srs-next[data-q]').forEach((span) => {
      span.textContent = previewNextInterval(entry.c, Number(span.dataset.q));
    });

    const sampleRead = (entry.kun[0] || entry.on[0] || '').replace(/[-.]/g, '');
    window.MediaCoach?.syncTarget?.({
      word: entry.c,
      reading: sampleRead,
      lang: 'ja-JP',
      mountId: 'jpMediaCoachMount',
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

  async function getTextbookKanjiEntries(filterVal) {
    const tb = await ensureTextbookLoaded();
    if (!tb || !tb.lessons) return [];
    let chars = [];
    if (filterVal === 'all') {
      chars = tb.allKanji || [];
    } else {
      const lesson = tb.lessons.find((l) => String(l.lessonNum) === String(filterVal));
      chars = lesson ? lesson.kanjiChars : [];
    }
    const needed = new Set(chars.map((c) => state.kanjiLookup[c]?.l).filter(Boolean));
    await Promise.all([...needed].map((l) => loadLevel(l)));

    const entries = [];
    const seen = new Set();
    for (const ch of chars) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      const lvl = state.kanjiLookup[ch]?.l;
      const found = (state.levelCache[lvl] || []).find((k) => k.c === ch);
      if (found) entries.push(found);
    }
    return entries;
  }

  async function applyTextbookFilter(filterVal, pickFirst = true) {
    state.atelierTextbookFilter = filterVal;
    if ($('atelierTextbookSelect')) $('atelierTextbookSelect').value = filterVal;
    if (!filterVal) {
      applyFilterAndRender();
      return;
    }
    state.textbookEntries = await getTextbookKanjiEntries(filterVal);
    applyFilterAndRender();
    if (pickFirst && state.filteredList.length) {
      selectKanji(state.filteredList[0]);
    }
  }

  function applyFilterAndRender() {
    const q = state.searchQuery.trim();
    const normQ = stripVietnamese(q);
    const kanaQ = /^[a-zA-Z\u3040-\u30ff]+$/.test(q) ? romajiToHiragana(q) : '';

    if (state.globalSearch && q) {
      // Search across all entries in kanjiLookup
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

    const baseList = state.atelierTextbookFilter
      ? (state.textbookEntries || [])
      : (state.levelCache[state.currentLevel] || []);

    if (state.filterStatus === 'today') {
      const todayStr = getLocalDateKey();
      const s = state.progress.settings;
      if (s) {
        if (!s.jpDailyNewLimit) s.jpDailyNewLimit = 10;
        if (s.jpDailyNewDate !== todayStr) {
          s.jpDailyNewDate = todayStr;
          s.jpDailyNewCount = 0;
        }
      }

      // 1. Due Kanji (excluding sessionFailedSet)
      const dueList = baseList.filter((entry) => getKanjiStatus(entry.c) === 'due' && !state.sessionFailedSet.has(entry.c));

      // 2. New Kanji up to remaining quota
      const remainingNew = Math.max(0, (s?.jpDailyNewLimit || 10) - (s?.jpDailyNewCount || 0));
      const allNew = baseList.filter((entry) => getKanjiStatus(entry.c) === 'new' && !state.sessionFailedSet.has(entry.c));
      const newList = allNew.slice(0, remainingNew);

      // 3. Retry Kanji in current session
      const retryList = baseList.filter((entry) => state.sessionFailedSet.has(entry.c));

      const rawTodayList = [...dueList, ...newList, ...retryList];
      state.filteredList = rawTodayList.filter((entry) => matchesQuery(entry, q, normQ, kanaQ));

      const prefix = state.atelierTextbookFilter
        ? (state.atelierTextbookFilter === 'all' ? '中級へ行こう' : `Bài ${state.atelierTextbookFilter}`)
        : `N${state.currentLevel}`;
      $('listMetaText').textContent = `🔥 Hôm nay: ${state.filteredList.length} chữ (${dueList.length} cần ôn + ${newList.length} mới${retryList.length ? ` + ${retryList.length} ôn lại` : ''})`;
      renderKanjiList('reset');
      return;
    }

    state.filteredList = baseList.filter((entry) => {
      if (state.filterStatus !== 'all' && getKanjiStatus(entry.c) !== state.filterStatus) {
        return false;
      }
      return matchesQuery(entry, q, normQ, kanaQ);
    });

    const prefix = state.atelierTextbookFilter
      ? (state.atelierTextbookFilter === 'all' ? '中級へ行こう' : `Bài ${state.atelierTextbookFilter}`)
      : `N${state.currentLevel}`;
    $('listMetaText').textContent = `${prefix}: ${state.filteredList.length} / ${baseList.length} chữ`;
    renderKanjiList('reset');
  }

  function renderKanjiList(action = 'reset') {
    const container = $('kanjiList');
    if (action === 'dots') {
      qsa('#kanjiList .kanji-item').forEach((btn) => {
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
      if (!state.filteredList.length) {
        if (state.filterStatus === 'today') {
          const s = state.progress.settings;
          const card = document.createElement('div');
          card.className = 'today-complete-card';
          card.innerHTML = `
            <div class="today-complete-icon">🎉</div>
            <h4>Hoàn thành mục tiêu hôm nay!</h4>
            <p>Bạn đã giải quyết sạch các chữ cần ôn và đạt chỉ tiêu chữ mới của ngày hôm nay.</p>
            <div class="today-complete-stats">
              <span class="stat-tag">Cần ôn: <strong>0 còn lại</strong></span>
              <span class="stat-tag">Đã nạp: <strong>${s?.jpDailyNewCount || 0} / ${s?.jpDailyNewLimit || 10} chữ mới</strong></span>
            </div>
            <div class="today-complete-actions">
              <button type="button" class="btn btn-primary" id="jpCompleteAddMoreBtn">+ Học thêm 5 chữ mới</button>
              <button type="button" class="btn" id="jpCompleteViewAllBtn">Xem tất cả chữ Hán</button>
            </div>
          `;
          container.appendChild(card);
          card.querySelector('#jpCompleteAddMoreBtn')?.addEventListener('click', () => {
            s.jpDailyNewLimit = (s.jpDailyNewLimit || 10) + 5;
            if ($('jpDailyLimitSelect')) $('jpDailyLimitSelect').value = String(s.jpDailyNewLimit);
            scheduleSaveProgress(true);
            updateDueBadge();
            applyFilterAndRender();
            if (state.filteredList.length) selectKanji(state.filteredList[0]);
          });
          card.querySelector('#jpCompleteViewAllBtn')?.addEventListener('click', () => {
            state.filterStatus = 'all';
            qsa('.filter-chip[data-filter]').forEach((c) => c.classList.toggle('active', c.dataset.filter === 'all'));
            applyFilterAndRender();
            if (state.filteredList.length) selectKanji(state.filteredList[0]);
          });
        }
        return;
      }
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
      const lvlBadge = (item._isLookup || state.atelierTextbookFilter) ? `N${item.l} · ` : '';
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
    if (pickFirst && state.atelierTextbookFilter) {
      state.atelierTextbookFilter = '';
      if ($('atelierTextbookSelect')) $('atelierTextbookSelect').value = '';
    }
    qsa('#jpLevelTabs .level-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.level) === level));
    const list = await loadLevel(level);
    applyFilterAndRender();
    if (pickFirst && list.length) {
      const target = state.filteredList.find((x) => !x._isLookup) || list[0];
      selectKanji(target);
    }
    if (state.readingsLoaded && state.readerFilter !== 'chukyu') {
      renderReaderList(true);
    }
    if (state.examsLoaded && state.examMode === 'exams') {
      renderExamList(true);
    }
    if (state.sentencesLoaded) {
      renderForgeList(true);
    }
  }

  async function getFullKanjiEntry(ch) {
    const meta = state.kanjiLookup[ch];
    if (!meta) return null;
    const list = await loadLevel(meta.l);
    return list.find((k) => k.c === ch) || null;
  }

  function enqueueKanjiForSrs(ch) {
    if (!state.kanjiLookup[ch]) return;
    const prev = state.progress.kanji[ch] || { reps: 0, interval: 0, ease: 2.5, writePasses: 0, blindPasses: 0, note: '' };
    prev.due = new Date().toISOString();
    state.progress.kanji[ch] = prev;
    scheduleSaveProgress(true);
    updateDueBadge();
    renderKanjiList('dots');
  }

  // --- Mode 4: Active Recall Typing Check (Shared helper for Atelier & Dojo) ---
  function evaluateKanjiRecallTyping(entry, hvRaw, readRaw) {
    const hvInput = stripVietnamese(hvRaw).trim();
    const readInputRaw = (readRaw || '').trim();
    const readKana = cleanReadingToken(
      /^[a-zA-Z\s'-]+$/.test(readInputRaw) ? romajiToHiragana(readInputRaw) : readInputRaw
    );

    const validHvs = [stripVietnamese(entry.hv), ...(entry.hvAll || []).map(stripVietnamese)].filter(Boolean);
    const hvOk = hvInput.length > 0 && validHvs.includes(hvInput);

    const validReadings = [...entry.on, ...entry.kun].map(cleanReadingToken).filter(Boolean);
    const readOk = readKana.length > 0 && validReadings.some((r) => r === readKana || r.startsWith(readKana));
    return { hvOk, readOk, readKana };
  }

  function handleTypingSubmit(e) {
    e.preventDefault();
    const entry = state.currentKanji;
    if (!entry) return;

    const { hvOk, readOk, readKana } = evaluateKanjiRecallTyping(
      entry,
      $('inputHanViet').value,
      $('inputReading').value
    );

    const resEl = $('typingResult');
    resEl.classList.remove('hidden', 'ok', 'warn');

    if (hvOk && readOk) {
      playWoodTap(true);
      resEl.classList.add('ok');
      resEl.textContent = `Chính xác! ${entry.c} — ${entry.hv} | On: ${entry.on.join(', ') || '—'} | Kun: ${entry.kun.join(', ') || '—'}`;
      suggestJpSrsGrade(3);
    } else {
      playWoodTap(false);
      resEl.classList.add('warn');
      const parts = [];
      if (!hvOk) parts.push(`Âm Hán-Việt chưa đúng (đáp án: ${entry.hv})`);
      if (!readOk) parts.push(`Cách đọc Kana chưa khớp (${readKana || 'trống'})`);
      resEl.textContent = parts.join('. ') + '. Hãy tự kiểm lại rồi gõ lại.';
    }
  }

  // --- View & Language Space Switching ---
  function renderHomeHub() {
    const s = state.progress.stats || {};
    const focusMin = Math.round((s.totalFocusSeconds || 0) / 60);
    const jpTouched = Object.keys(state.progress.kanji || {}).length;
    const totalKanjiDb = Object.keys(state.kanjiLookup).length || 2230;
    const jpDue = getDueKanjiChars().length;
    const readingsDone = Object.keys(state.progress.readingsDone || {}).length;
    const readingsTotal = (state.readingsLoaded && state.readings.length) || 35;

    const enMap = state.progress.enVocab || {};
    const enTouched = Object.keys(enMap).length;
    const enDue = getDueEnWords().length;
    const enTotal = window.EnAtelierApp?.getTotalCount?.() || 253;
    const enRootsCount = window.EnAtelierApp?.getRootsCount?.() || 36;
    const enReadingStats = window.EnAtelierApp?.getEnReadingStats?.();
    const enReadingsDone = typeof enReadingStats?.done === 'number'
      ? enReadingStats.done
      : Object.keys(state.progress.enReadingsDone || {}).length;
    const enReadingsTotal = typeof enReadingStats?.total === 'number' && enReadingStats.total > 0
      ? enReadingStats.total
      : 15;

    if ($('homeStatFocusMin')) $('homeStatFocusMin').textContent = `${focusMin} phút`;
    if ($('homeStatTotalLearned')) $('homeStatTotalLearned').textContent = String(jpTouched + enTouched);
    if ($('homeStatTotalDue')) $('homeStatTotalDue').textContent = String(jpDue + enDue);

    if ($('homeJpLearned')) $('homeJpLearned').textContent = `${jpTouched} / ${totalKanjiDb}`;
    if ($('homeJpDue')) $('homeJpDue').textContent = `${jpDue} chữ`;
    if ($('homeJpReadings')) $('homeJpReadings').textContent = `${readingsDone} / ${readingsTotal} bài`;

    if ($('homeEnLearned')) $('homeEnLearned').textContent = `${enTouched} / ${enTotal}`;
    if ($('homeEnDue')) $('homeEnDue').textContent = `${enDue} từ`;
    if ($('homeEnRootsCount')) $('homeEnRootsCount').textContent = `${enRootsCount} gốc`;
    if ($('homeEnReadings')) $('homeEnReadings').textContent = `${enReadingsDone} / ${enReadingsTotal} bài`;

    if (window.EnAtelierApp?.renderHomeQuickRoots) {
      window.EnAtelierApp.renderHomeQuickRoots();
    }
  }

  function switchAppSpace(space, targetView) {
    window.MediaCoach?.pauseAll?.();
    if (space !== 'en' || targetView === 'neuro' || targetView === 'enReader') {
      window.EnAtelierApp?.pauseGame?.();
    }
    state.currentSpace = space;
    qsa('.space-btn').forEach((b) => b.classList.toggle('active', b.dataset.space === space));

    const brands = {
      home: { seal: '悟', title: 'SANCTUARY HUB', sub: 'Không gian học sâu đa ngôn ngữ' },
      jp: { seal: '墨', title: 'BOKUSEKI', sub: 'Giải phẫu & Luyện tự Kanji N5–N1' },
      en: { seal: '語', title: 'LEXICON', sub: 'Giải phẫu Gốc từ & Chính tả Tiếng Anh' },
    }[space] || { seal: '悟', title: 'SANCTUARY HUB', sub: '' };

    if ($('brandSeal')) $('brandSeal').textContent = brands.seal;
    if ($('brandTitle')) $('brandTitle').textContent = brands.title;
    if ($('brandSub')) $('brandSub').textContent = brands.sub;

    $('jpViewTabs').classList.toggle('hidden', space !== 'jp');
    $('enViewTabs').classList.toggle('hidden', space !== 'en');
    $('viewHome').classList.toggle('hidden', space !== 'home');

    if (space !== 'jp') {
      $('readerAudioEl')?.pause();
      $('examAudioEl')?.pause();
      ['viewAtelier', 'viewReader', 'viewForge', 'viewExams', 'viewDojo'].forEach((id) => {
        $(id)?.classList.add('hidden');
      });
    }

    const enLevelTabs = $('enLevelTabs');
    if (!(space === 'en' && targetView === 'enReader')) {
      const atelierLeft = document.querySelector('#viewEnAtelier .panel-left');
      if (enLevelTabs && atelierLeft && atelierLeft.firstElementChild !== enLevelTabs) {
        atelierLeft.prepend(enLevelTabs);
      }
    }

    if (space === 'home') {
      $('viewNeuro').classList.add('hidden');
      $('viewEnAtelier').classList.add('hidden');
      $('viewEnReader')?.classList.add('hidden');
      renderHomeHub();
      return;
    }

    if (space === 'jp') {
      $('viewEnAtelier').classList.add('hidden');
      $('viewEnReader')?.classList.add('hidden');
      switchView(targetView || state.currentView || 'atelier');
      return;
    }

    if (space === 'en') {
      if (targetView === 'neuro') {
        $('viewEnAtelier').classList.add('hidden');
        $('viewEnReader')?.classList.add('hidden');
        $('viewNeuro').classList.remove('hidden');
        qsa('#enViewTabs .en-view-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.enview === 'neuro');
        });
        renderNeuroDashboard();
        refreshGitStatus();
        Promise.all([
          ensureReadingsLoaded().catch(() => {}),
          ensureSentencesLoaded().catch(() => {}),
          ensureExamsLoaded().catch(() => {}),
          ensureTextbookLoaded().catch(() => {}),
          ensureMimiBookLoaded().catch(() => {}),
          window.EnAtelierApp?.ensureReadingsLoaded?.().catch(() => {}),
        ]).then(() => {
          if (state.currentSpace === 'en' && !$('viewNeuro')?.classList.contains('hidden')) {
            renderNeuroDashboard();
          }
        });
      } else if (targetView === 'enReader') {
        $('viewNeuro').classList.add('hidden');
        $('viewEnAtelier').classList.add('hidden');
        $('viewEnReader')?.classList.remove('hidden');
        const readerLeft = document.querySelector('#viewEnReader .panel-left');
        if (enLevelTabs && readerLeft && readerLeft.firstElementChild !== enLevelTabs) {
          readerLeft.prepend(enLevelTabs);
        }
        qsa('#enViewTabs .en-view-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.enview === 'enReader');
        });
        Promise.resolve(window.EnAtelierApp?.onEnterSpace?.('enReader')).then(() => {
          if (state.currentSpace === 'en' && !$('viewEnReader')?.classList.contains('hidden')) {
            qsa('#enViewTabs .en-view-btn').forEach((b) => {
              b.classList.toggle('active', b.dataset.enview === 'enReader');
            });
          }
        }).catch(() => {});
      } else {
        $('viewNeuro').classList.add('hidden');
        $('viewEnReader')?.classList.add('hidden');
        $('viewEnAtelier').classList.remove('hidden');
        if (window.EnAtelierApp?.onEnterSpace) {
          window.EnAtelierApp.onEnterSpace(targetView || 'enAtelier');
        }
      }
    }
  }

  function switchView(view) {
    window.MediaCoach?.pauseAll?.();
    state.currentView = view;
    qsa('#jpViewTabs .view-btn').forEach((b) => {
      const active = b.dataset.view === view;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });

    $('viewAtelier').classList.toggle('hidden', view !== 'atelier');
    $('viewReader').classList.toggle('hidden', view !== 'reader');
    $('viewForge').classList.toggle('hidden', view !== 'forge');
    $('viewExams').classList.toggle('hidden', view !== 'exams');
    $('viewDojo').classList.toggle('hidden', view !== 'dojo');
    $('viewNeuro').classList.toggle('hidden', view !== 'neuro');

    const levelTabs = $('jpLevelTabs');
    const viewPanelMap = {
      atelier: '#viewAtelier .panel-left',
      reader: '#viewReader .panel-left',
      forge: '#viewForge .panel-left',
      exams: '#viewExams .panel-left',
    };
    if (levelTabs && viewPanelMap[view]) {
      const targetPanel = document.querySelector(viewPanelMap[view]);
      if (targetPanel && targetPanel.firstElementChild !== levelTabs) {
        targetPanel.prepend(levelTabs);
      }
      levelTabs.classList.remove('hidden');
    }

    if (view === 'reader') {
      ensureReadingsLoaded().then(() => renderReaderList(!state.currentReading));
    } else if (view === 'forge') {
      ensureSentencesLoaded().then(() => renderForgeList(!state.currentSentence));
    } else if (view === 'exams') {
      ensureExamsLoaded().then(() => {
        if (state.examMode === 'textbook') switchTextbookBook(state.activeTextbookId || 'chukyu', true);
        else renderExamList(!state.currentExam);
      });
    } else if (view === 'neuro') {
      renderNeuroDashboard();
      refreshGitStatus();
      Promise.all([
        ensureReadingsLoaded().catch(() => {}),
        ensureSentencesLoaded().catch(() => {}),
        ensureExamsLoaded().catch(() => {}),
        ensureTextbookLoaded().catch(() => {}),
        ensureMimiBookLoaded().catch(() => {}),
        window.EnAtelierApp?.ensureReadingsLoaded?.().catch(() => {}),
      ]).then(() => {
        if (state.currentView === 'neuro') renderNeuroDashboard();
      });
    }
  }

  // =======================================================================
  // MODULE 3: ANTI-SKIMMING DEEP READER
  // =======================================================================
  async function ensureReadingsLoaded() {
    if (state.readingsLoaded) return;
    const [rRes, vRes] = await Promise.all([
      fetch('data/readings.json'),
      fetch('data/vocab-dict.json').catch(() => null),
    ]);
    state.readings = await rRes.json();
    if (vRes && vRes.ok) {
      try {
        state.vocabDict = await vRes.json();
      } catch (_) {
        state.vocabDict = {};
      }
    }
    state.readingsLoaded = true;
  }

  function getAllReadings() {
    return [...(state.progress.customReadings || []), ...state.readings];
  }

  function getReadingStatus(r) {
    return state.progress.readingsDone && state.progress.readingsDone[r.id] ? 'done' : 'unread';
  }

  function renderReaderList(autoPick = false) {
    const container = $('readerList');
    const allReadings = getAllReadings();
    const isChukyuMode = state.readerFilter === 'chukyu';
    const basePool = isChukyuMode
      ? allReadings.filter((r) => r.textbook === 'chukyu-e-ikou-2')
      : allReadings.filter((r) => r.level === state.currentLevel);

    const filtered = isChukyuMode
      ? basePool
      : basePool.filter((r) => state.readerFilter === 'all' || getReadingStatus(r) === state.readerFilter);

    $('readerListMeta').textContent = isChukyuMode
      ? `中級へ行こう: ${filtered.length} bài đọc`
      : `N${state.currentLevel}: ${filtered.length} / ${basePool.length} bài đọc`;
    container.innerHTML = '';

    if (!filtered.length) {
      container.innerHTML = '<div class="rk-empty">Không có bài đọc khớp bộ lọc. Bạn có thể bấm "+ Dán bài đọc mới" hoặc chọn tab "Giáo trình (10)".</div>';
      return;
    }

    filtered.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kanji-item';
      if (state.currentReading && state.currentReading.id === r.id) btn.classList.add('active');
      const done = getReadingStatus(r) === 'done';
      const badgeText = r.textbook ? `B${r.lessonNum}` : `N${r.level}`;
      btn.innerHTML = `
        <span class="kanji-item-glyph" style="font-size:15px;">${escHtml(badgeText)}</span>
        <span class="kanji-item-body">
          <div class="kanji-item-hv">${escHtml(r.title)}</div>
          <div class="kanji-item-vi">${escHtml(r.paragraphs.length)} đoạn · ${escHtml(r.category || 'Đọc sâu')}</div>
        </span>
        <span class="kanji-item-dot ${done ? 'mastered' : ''}"></span>
      `;
      btn.addEventListener('click', () => selectReading(r));
      container.appendChild(btn);
    });

    const stillInFiltered = state.currentReading && filtered.some((r) => r.id === state.currentReading.id);
    if (autoPick || !stillInFiltered) {
      selectReading(filtered[0]);
    }
  }

  function extractKanjiChars(text) {
    const seen = new Set();
    const out = [];
    for (const ch of text || '') {
      if (state.kanjiLookup[ch] && !seen.has(ch)) {
        seen.add(ch);
        out.push(ch);
      }
    }
    return out;
  }

  function buildKanjiFallbackText(word) {
    const parts = [];
    for (const ch of word || '') {
      const m = state.kanjiLookup[ch];
      if (m && m.vi) parts.push(`${ch} (${m.vi.split(',')[0].trim()})`);
    }
    return parts.join(' + ');
  }

  function buildWordHanViet(word) {
    const parts = [];
    for (const ch of word || '') {
      const m = state.kanjiLookup[ch];
      if (m && m.hv) parts.push(m.hv);
    }
    return parts.join(' ');
  }

  function buildInteractiveJpFragment(text, para = null) {
    // Kept for simple fragments (like Forge); inside Deep Reader pass para to render ruby words
    const frag = document.createDocumentFragment();
    if (!para) {
      for (const ch of text) {
        if (state.kanjiLookup[ch]) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'inline-kanji';
          if (getKanjiStatus(ch) === 'due') btn.classList.add('srs-due');
          if (state.readerSelectedKanji === ch) btn.classList.add('selected');
          btn.textContent = ch;
          btn.title = `Bấm giải phẫu chữ ${ch} (${state.kanjiLookup[ch].hv})`;
          btn.addEventListener('click', () => inspectReaderKanji(ch));
          frag.appendChild(btn);
        } else {
          frag.appendChild(document.createTextNode(ch));
        }
      }
      return frag;
    }

    const wordMap = new Map();
    if (state.vocabDict) {
      for (const [w, info] of Object.entries(state.vocabDict)) {
        if (text.includes(w)) {
          wordMap.set(w, {
            r: info.r || '',
            m: info.m || '',
            hv: info.hv || buildWordHanViet(w),
          });
        }
      }
    }
    if (Array.isArray(para.words)) {
      para.words.forEach(([w, r, m, hv]) => {
        if (w && text.includes(w)) {
          wordMap.set(w, { r: r || '', m: m || '', hv: hv || buildWordHanViet(w) });
        }
      });
    }
    if (Array.isArray(para.vocab)) {
      para.vocab.forEach(([w, r, m]) => {
        if (w && text.includes(w) && /[\u4e00-\u9faf々]/.test(w)) {
          const prev = wordMap.get(w) || {};
          wordMap.set(w, {
            r: r || prev.r || '',
            m: m || prev.m || '',
            hv: prev.hv || buildWordHanViet(w),
          });
        }
      });
    }

    const keys = Array.from(wordMap.keys()).sort((a, b) => b.length - a.length);
    let plainBuf = '';
    const flushPlain = () => {
      if (plainBuf) {
        frag.appendChild(document.createTextNode(plainBuf));
        plainBuf = '';
      }
    };

    const appendRubyNode = (word, info) => {
      flushPlain();
      const ruby = document.createElement('ruby');
      ruby.className = 'ruby-word';
      ruby.dataset.word = word;
      if (state.readerSelectedWord === word) ruby.classList.add('selected');
      const kanjis = extractKanjiChars(word);
      if (kanjis.some((ch) => getKanjiStatus(ch) === 'due')) {
        ruby.classList.add('srs-due');
      }
      ruby.title = 'Bấm để hiện Furigana, nghe đọc & xem nghĩa';
      ruby.appendChild(document.createTextNode(word));

      const rt = document.createElement('rt');
      rt.className = 'ruby-rt';
      rt.textContent = info.r || '';
      ruby.appendChild(rt);

      ruby.addEventListener('click', () => {
        const sel = window.getSelection ? window.getSelection() : null;
        if (sel && !sel.isCollapsed && sel.toString().trim().length > word.length) {
          return;
        }
        ruby.classList.add('revealed');
        speakJapaneseText(word, 0.9);
        inspectReaderWord(word, info);
      });
      frag.appendChild(ruby);
    };

    let i = 0;
    while (i < text.length) {
      let matchedWord = null;
      for (let k = 0; k < keys.length; k++) {
        if (text.startsWith(keys[k], i)) {
          matchedWord = keys[k];
          break;
        }
      }
      if (matchedWord) {
        appendRubyNode(matchedWord, wordMap.get(matchedWord));
        i += matchedWord.length;
      } else {
        const ch = text[i];
        if (state.kanjiLookup[ch]) {
          const meta = state.kanjiLookup[ch];
          const dictInfo = state.vocabDict[ch];
          appendRubyNode(ch, {
            r: (dictInfo && dictInfo.r) || meta.hv || '',
            m: (dictInfo && dictInfo.m) || meta.vi || '',
            hv: (dictInfo && dictInfo.hv) || meta.hv || '',
          });
        } else {
          plainBuf += ch;
        }
        i += 1;
      }
    }
    flushPlain();
    return frag;
  }

  function showReaderWordPanel({ word, reading, meaning, hv, sourceLabel }) {
    state.readerSelectedWord = word;
    qsa('#readerParagraphs .ruby-word').forEach((el) => {
      el.classList.toggle('selected', el.dataset.word === word);
    });

    $('rwEmptyHint').classList.add('hidden');
    $('rwBody').classList.remove('hidden');
    $('rwWord').textContent = word;
    $('rwReading').textContent = reading || '—';
    $('rwMeaning').textContent = meaning || '—';
    $('rwSourceHint').textContent = sourceLabel || 'Từ điển cục bộ';

    const hvEl = $('rwHv');
    if (hv) {
      hvEl.textContent = `Hán-Việt: ${hv}`;
      hvEl.classList.remove('hidden');
    } else {
      hvEl.classList.add('hidden');
    }

    const pillsBox = $('rwKanjiPills');
    pillsBox.innerHTML = '';
    const kanjis = extractKanjiChars(word);
    if (kanjis.length) {
      pillsBox.classList.remove('hidden');
      kanjis.forEach((ch) => {
        const meta = state.kanjiLookup[ch];
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'rw-kanji-pill';
        if (state.readerSelectedKanji === ch) pill.classList.add('active');
        pill.dataset.kanji = ch;
        pill.innerHTML = `<span class="rw-kanji-pill-glyph">${ch}</span><span>${meta.hv}</span>`;
        pill.addEventListener('click', () => inspectReaderKanji(ch));
        pillsBox.appendChild(pill);
      });
      if (!kanjis.includes(state.readerSelectedKanji)) {
        inspectReaderKanji(kanjis[0]);
      }
    } else {
      pillsBox.classList.add('hidden');
    }
  }

  function inspectReaderWord(word, info) {
    showReaderWordPanel({
      word,
      reading: info.r || '',
      meaning: info.m || buildKanjiFallbackText(word),
      hv: info.hv || buildWordHanViet(word),
      sourceLabel: 'Từ điển cục bộ',
    });
  }

  async function lookupAndInspectReaderText(rawText) {
    const clean = (rawText || '').trim().replace(/\s+/g, '');
    if (!clean) {
      $('rwEmptyHint').classList.remove('hidden');
      $('rwBody').classList.add('hidden');
      $('rwSourceHint').textContent = 'Từ điển cục bộ + dịch nhanh';
      return;
    }

    const localEntry = state.vocabDict[clean];
    if (localEntry) {
      showReaderWordPanel({
        word: clean,
        reading: localEntry.r,
        meaning: localEntry.m,
        hv: localEntry.hv || buildWordHanViet(clean),
        sourceLabel: 'Từ điển cục bộ',
      });
      return;
    }

    const seq = ++state.readerLookupSeq;
    showReaderWordPanel({
      word: clean,
      reading: 'Đang lấy cách đọc...',
      meaning: 'Đang tra cứu nghĩa & dịch câu...',
      hv: buildWordHanViet(clean),
      sourceLabel: 'Đang tra cứu...',
    });

    if (!state.hasServerApi) {
      showReaderWordPanel({
        word: clean,
        reading: '',
        meaning: buildKanjiFallbackText(clean) || 'Chế độ ngoại tuyến (không có server tra cứu)',
        hv: buildWordHanViet(clean),
        sourceLabel: 'Ngoại tuyến',
      });
      return;
    }

    try {
      const res = await fetch(`/api/lookup?text=${encodeURIComponent(clean)}`);
      if (seq !== state.readerLookupSeq) return;
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok) {
          if (data.isSingleWord && data.reading && data.meaning && !data.meaning.includes('Chưa có bản dịch')) {
            state.vocabDict[clean] = { r: data.reading, m: data.meaning, hv: data.hv || '' };
          }
          showReaderWordPanel({
            word: data.text || clean,
            reading: data.reading || '',
            meaning: data.meaning || buildKanjiFallbackText(clean),
            hv: data.hv || buildWordHanViet(clean),
            sourceLabel: data.source === 'local' ? 'Từ điển cục bộ' : 'Dịch nhanh + Mazii',
          });
          return;
        }
      }
    } catch (_) {}

    if (seq !== state.readerLookupSeq) return;
    showReaderWordPanel({
      word: clean,
      reading: '',
      meaning: buildKanjiFallbackText(clean) || 'Không thể tra cứu trực tuyến lúc này.',
      hv: buildWordHanViet(clean),
      sourceLabel: 'Dự phòng cục bộ',
    });
  }

  function setAudioTrackSource(audioEl, url, playBtn, seekEl, timeEl, autoPlay = false) {
    audioEl.pause();
    if (!url) {
      audioEl.removeAttribute('src');
      return;
    }
    audioEl.src = encodeUrlPath(url);
    playBtn.textContent = autoPlay ? 'Tạm dừng' : 'Nghe Audio';
    timeEl.textContent = '00:00 / 00:00';
    seekEl.value = '0';
    if (autoPlay) audioEl.play().catch(() => {});
  }

  function configureDualTrackButtons(slowBtn, natBtn, activeTrack) {
    slowBtn.className = activeTrack === 'slow' ? 'btn-primary-sm' : 'btn-ghost-sm';
    natBtn.className = activeTrack === 'nat' ? 'btn-primary-sm' : 'btn-ghost-sm';
  }

  function selectReading(reading) {
    state.currentReading = reading;
    state.readerUnlockedIdx = 0;
    state.readerAllUnlocked = false;
    state.readerParaShowAll = {};
    state.readerSelectedWord = '';
    state.readerLookupSeq += 1;
    state.readerQuestionTimers.forEach(clearInterval);
    state.readerQuestionTimers = [];

    const rBar = $('readerAudioBar');
    const rAudio = $('readerAudioEl');
    rAudio.pause();
    if (reading.audioSlow || reading.audioNatural) {
      rBar.classList.remove('hidden');
      const initUrl = reading.audioSlow || reading.audioNatural;
      configureDualTrackButtons($('readerTrackSlowBtn'), $('readerTrackNatBtn'), reading.audioSlow ? 'slow' : 'nat');
      setAudioTrackSource(rAudio, initUrl, $('readerAudioPlayBtn'), $('readerAudioSeek'), $('readerAudioTime'), false);
    } else {
      rBar.classList.add('hidden');
      setAudioTrackSource(rAudio, '', $('readerAudioPlayBtn'), $('readerAudioSeek'), $('readerAudioTime'), false);
    }

    $('readerQuickLookupInput').value = '';
    $('rwEmptyHint').classList.remove('hidden');
    $('rwBody').classList.add('hidden');
    $('rwSourceHint').textContent = 'Từ điển cục bộ + dịch nhanh';

    qsa('#readerList .kanji-item').forEach((el) => {
      el.classList.toggle('active', el.querySelector('.kanji-item-hv')?.textContent === reading.title);
    });

    $('readerLevelTag').textContent = `JLPT N${reading.level}`;
    $('readerCategoryTag').textContent = reading.category || 'Đoản văn';
    $('readerSourceTag').textContent = reading.source || '';
    $('readerTitle').textContent = reading.title;

    // Extract & render all Kanji inside this article
    const fullJp = reading.paragraphs.map((p) => p.jp).join('\n');
    const kanjiChars = extractKanjiChars(fullJp);
    $('readerKanjiCount').textContent = `${kanjiChars.length} chữ`;
    const chipsEl = $('readerKanjiChips');
    chipsEl.innerHTML = '';
    kanjiChars.forEach((ch) => {
      const meta = state.kanjiLookup[ch];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'related-chip';
      chip.innerHTML = `<span class="related-chip-glyph">${ch}</span><span>${meta.hv}</span><span class="related-chip-lvl">N${meta.l}</span>`;
      chip.addEventListener('click', () => inspectReaderKanji(ch));
      chipsEl.appendChild(chip);
    });
    if (kanjiChars.length) {
      inspectReaderKanji(kanjiChars[0]);
    } else {
      $('rkEmptyHint').classList.remove('hidden');
      $('rkBody').classList.add('hidden');
    }

    renderReadingParagraphs();
    renderReadingQuestions();
    renderReadingSummaryBox();
  }

  function renderReadingParagraphs() {
    const reading = state.currentReading;
    if (!reading) return;
    const container = $('readerParagraphs');
    container.innerHTML = '';

    reading.paragraphs.forEach((para, idx) => {
      const isLocked = !state.readerAllUnlocked && idx > state.readerUnlockedIdx;
      const isCurrent = !state.readerAllUnlocked && idx === state.readerUnlockedIdx;

      const card = document.createElement('article');
      card.className = `para-card${isCurrent ? ' active' : ''}${isLocked ? ' blurred' : ''}`;

      const head = document.createElement('div');
      head.className = 'para-head';
      head.innerHTML = `<span class="mono">Đoạn ${idx + 1} / ${reading.paragraphs.length}</span><span>${isLocked ? 'Đang khóa chống đọc lướt' : isCurrent ? 'Đoạn đang đọc' : 'Đã mở'}</span>`;
      card.appendChild(head);

      const jpDiv = document.createElement('div');
      jpDiv.className = 'para-jp';
      if (state.readerParaShowAll[idx]) jpDiv.classList.add('show-all-ruby');
      jpDiv.appendChild(buildInteractiveJpFragment(para.jp, para));
      card.appendChild(jpDiv);

      if (para.vocab && para.vocab.length) {
        const vRow = document.createElement('div');
        vRow.className = 'para-vocab-row';
        para.vocab.forEach(([word, read, meaning]) => {
          const vBtn = document.createElement('button');
          vBtn.type = 'button';
          vBtn.className = 'vocab-friction-chip';
          vBtn.title = 'Giữ chuột 0,5s hoặc bấm để hiện cách đọc & nghĩa';
          vBtn.innerHTML = `<span class="vf-word">${word}</span><span class="vf-secret">Giữ 0,5s để xem</span>`;

          let holdTimer = null;
          const reveal = () => {
            vBtn.classList.add('revealed');
            vBtn.querySelector('.vf-secret').textContent = `${read} · ${meaning}`;
          };
          vBtn.addEventListener('pointerdown', () => {
            clearTimeout(holdTimer);
            holdTimer = setTimeout(reveal, 450);
          });
          vBtn.addEventListener('pointerup', () => clearTimeout(holdTimer));
          vBtn.addEventListener('pointerleave', () => clearTimeout(holdTimer));
          vBtn.addEventListener('click', () => {
            if (!vBtn.classList.contains('revealed')) {
              setTimeout(reveal, 400);
            }
          });
          vRow.appendChild(vBtn);
        });
        card.appendChild(vRow);
      }

      if (!isLocked) {
        let viDiv = null;
        if (para.vi) {
          viDiv = document.createElement('div');
          viDiv.className = 'para-vi hidden';
          viDiv.textContent = para.vi;
        }

        const actions = document.createElement('div');
        actions.className = 'para-actions';

        const leftBtns = document.createElement('div');
        leftBtns.style.display = 'flex';
        leftBtns.style.flexWrap = 'wrap';
        leftBtns.style.gap = '6px';

        const speakBtn = document.createElement('button');
        speakBtn.type = 'button';
        speakBtn.className = 'btn-ghost-sm';
        speakBtn.textContent = 'Nghe đoạn này';
        speakBtn.addEventListener('click', () => speakJapaneseText(para.jp, 0.88));
        leftBtns.appendChild(speakBtn);

        const furiganaBtn = document.createElement('button');
        furiganaBtn.type = 'button';
        furiganaBtn.className = 'btn-ghost-sm';
        furiganaBtn.textContent = state.readerParaShowAll[idx] ? 'Ẩn Furigana' : 'Hiện Furigana đoạn này';
        furiganaBtn.addEventListener('click', () => {
          const next = !state.readerParaShowAll[idx];
          state.readerParaShowAll[idx] = next;
          jpDiv.classList.toggle('show-all-ruby', next);
          furiganaBtn.textContent = next ? 'Ẩn Furigana' : 'Hiện Furigana đoạn này';
        });
        leftBtns.appendChild(furiganaBtn);

        if (viDiv) {
          const transBtn = document.createElement('button');
          transBtn.type = 'button';
          transBtn.className = 'btn-ghost-sm';
          transBtn.textContent = 'Xem dịch đối chiếu';
          transBtn.addEventListener('click', () => {
            viDiv.classList.toggle('hidden');
            transBtn.textContent = viDiv.classList.contains('hidden') ? 'Xem dịch đối chiếu' : 'Ẩn dịch';
          });
          leftBtns.appendChild(transBtn);
        }

        actions.appendChild(leftBtns);

        if (isCurrent) {
          const nextBtn = document.createElement('button');
          nextBtn.type = 'button';
          nextBtn.className = 'btn-primary-sm';
          const isLast = idx === reading.paragraphs.length - 1;
          nextBtn.textContent = isLast
            ? (reading.questions && reading.questions.length ? 'Mở câu hỏi hiểu sâu →' : 'Hoàn tất đọc đoạn → Tóm tắt')
            : 'Đã hiểu đoạn này → Mở đoạn tiếp';
          nextBtn.addEventListener('click', () => {
            if (isLast) {
              state.readerAllUnlocked = true;
            } else {
              state.readerUnlockedIdx += 1;
            }
            renderReadingParagraphs();
            renderReadingQuestions();
            renderReadingSummaryBox();
          });
          actions.appendChild(nextBtn);
        }

        card.appendChild(actions);
        if (viDiv) card.appendChild(viDiv);
      }

      container.appendChild(card);
    });
  }

  function renderReadingQuestions() {
    const reading = state.currentReading;
    const box = $('readerQuestionsBox');
    const listEl = $('readerQuestionsList');
    if (!reading || !state.readerAllUnlocked || !reading.questions || !reading.questions.length) {
      box.classList.add('hidden');
      return;
    }

    box.classList.remove('hidden');
    listEl.innerHTML = '';

    reading.questions.forEach((item, qIdx) => {
      const qDiv = document.createElement('div');
      qDiv.className = 'rq-item';

      const prompt = document.createElement('div');
      prompt.className = 'rq-prompt';
      prompt.textContent = `Câu ${qIdx + 1}: ${item.q}`;
      qDiv.appendChild(prompt);

      const unlockBtn = document.createElement('button');
      unlockBtn.type = 'button';
      unlockBtn.className = 'btn-friction';
      unlockBtn.style.marginBottom = '8px';
      let sec = 5;
      unlockBtn.disabled = true;
      unlockBtn.textContent = `Tự suy nghĩ đáp án trước khi xem 4 lựa chọn (${sec}s)`;

      const optsWrap = document.createElement('div');
      optsWrap.className = 'rq-options locked';

      const explainDiv = document.createElement('div');
      explainDiv.className = 'rq-explain hidden';

      item.options.forEach((optText, oIdx) => {
        const optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'rq-opt-btn';
        optBtn.textContent = `${oIdx + 1}. ${optText}`;
        optBtn.addEventListener('click', () => {
          optsWrap.querySelectorAll('.rq-opt-btn').forEach((b, bi) => {
            b.classList.toggle('correct', bi === item.answer);
            if (bi === oIdx && bi !== item.answer) b.classList.add('wrong');
          });
          playWoodTap(oIdx === item.answer);
          explainDiv.textContent = (oIdx === item.answer ? 'Chính xác! ' : 'Chưa đúng. ') + (item.explanation || '');
          explainDiv.classList.remove('hidden');
        });
        optsWrap.appendChild(optBtn);
      });

      const t = setInterval(() => {
        sec -= 1;
        if (sec <= 0) {
          clearInterval(t);
          unlockBtn.disabled = false;
          unlockBtn.textContent = 'Mở khóa 4 lựa chọn';
        } else {
          unlockBtn.textContent = `Tự suy nghĩ đáp án trước khi xem 4 lựa chọn (${sec}s)`;
        }
      }, 1000);
      state.readerQuestionTimers.push(t);

      unlockBtn.addEventListener('click', () => {
        optsWrap.classList.remove('locked');
        unlockBtn.classList.add('hidden');
      });

      qDiv.appendChild(unlockBtn);
      qDiv.appendChild(optsWrap);
      qDiv.appendChild(explainDiv);
      listEl.appendChild(qDiv);
    });
  }

  function renderReadingSummaryBox() {
    const reading = state.currentReading;
    const box = $('readerSummaryBox');
    if (!reading || !state.readerAllUnlocked) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const saved = state.progress.readingsDone && state.progress.readingsDone[reading.id];
    $('readerSummaryInput').value = saved?.summary || '';
    $('readerDoneBadge').textContent = saved ? 'Đã hoàn thành bài đọc này' : 'Chưa hoàn thành';
  }

  async function renderMiniKanjiInspector(ch, prefix) {
    const entry = await getFullKanjiEntry(ch);
    if (!entry) return;

    $(`${prefix}EmptyHint`).classList.add('hidden');
    $(`${prefix}Body`).classList.remove('hidden');
    $(`${prefix}LevelTag`).classList.remove('hidden');
    $(`${prefix}LevelTag`).textContent = `N${entry.l} · ${entry.s} nét`;

    const svg = $(`${prefix}MiniSvg`);
    svg.innerHTML = '';
    entry.strokes.forEach((d) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', 'kvg-stroke-drawn');
      svg.appendChild(p);
    });

    $(`${prefix}Hv`).textContent = `${entry.c} — ${entry.hv}`;
    $(`${prefix}Vi`).textContent = entry.vi.slice(0, 4).join(' · ') || entry.en.slice(0, 3).join(' · ');
    $(`${prefix}Readings`).textContent = `On: ${entry.on.join(', ') || '—'} | Kun: ${entry.kun.join(', ') || '—'}`;
    $(`${prefix}Radical`).textContent = `Bộ thủ: ${entry.rad || '—'}`;

    const partsBox = $(`${prefix}Parts`);
    partsBox.innerHTML = '';
    entry.parts.filter((p) => p.depth === 1).forEach((p) => {
      const line = document.createElement('div');
      line.className = 'sub-hint';
      line.textContent = `• ${p.el} (${p.hv || 'Bộ phận'}): ${p.vi || ''}`;
      partsBox.appendChild(line);
    });
  }

  async function inspectReaderKanji(ch) {
    state.readerSelectedKanji = ch;
    qsa('#rwKanjiPills .rw-kanji-pill').forEach((el) => {
      el.classList.toggle('active', el.dataset.kanji === ch);
    });
    await renderMiniKanjiInspector(ch, 'rk');
  }

  // =======================================================================
  // MODULE 4: SENTENCE FORGE & BLIND DICTATION
  // =======================================================================
  async function ensureSentencesLoaded() {
    if (state.sentencesLoaded) return;
    const res = await fetch('data/sentences.json');
    state.sentences = await res.json();
    state.sentencesLoaded = true;
  }

  function isSentenceDone(s) {
    const rec = state.progress.sentencesDone && state.progress.sentencesDone[s.id];
    if (!rec) return false;
    return state.forgeMode === 'forge' ? Boolean(rec.forge) : Boolean(rec.dictation);
  }

  function renderForgeList(autoPick = false) {
    const container = $('forgeList');
    const allForLevel = state.sentences.filter((s) => s.level === state.currentLevel);
    const filtered = allForLevel.filter((s) => {
      if (state.forgeFilter === 'done') return isSentenceDone(s);
      if (state.forgeFilter === 'todo') return !isSentenceDone(s);
      return true;
    });

    $('forgeListMeta').textContent = `N${state.currentLevel}: ${filtered.length} / ${allForLevel.length} câu`;
    container.innerHTML = '';

    if (!filtered.length) {
      container.innerHTML = '<div class="rk-empty">Không có câu khớp bộ lọc hiện tại.</div>';
      return;
    }

    filtered.forEach((s, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kanji-item';
      if (state.currentSentence && state.currentSentence.id === s.id) btn.classList.add('active');
      const done = isSentenceDone(s);
      const titleText = state.forgeMode === 'dictation' && !done
        ? `Câu nghe chép #${idx + 1} (${s.kana.length} ký tự)`
        : (s.prefix || s.chunks[0]).slice(0, 16) + '...';
      btn.innerHTML = `
        <span class="kanji-item-glyph" style="font-size:14px;">#${idx + 1}</span>
        <span class="kanji-item-body">
          <div class="kanji-item-hv">${titleText}</div>
          <div class="kanji-item-vi">${s.source.replace('Đề JLPT ', '')}</div>
        </span>
        <span class="kanji-item-dot ${done ? 'mastered' : ''}"></span>
      `;
      btn.addEventListener('click', () => selectSentence(s));
      container.appendChild(btn);
    });

    if (autoPick || !state.currentSentence || state.currentSentence.level !== state.currentLevel) {
      selectSentence(filtered[0]);
    }
  }

  function shuffleIndices() {
    const arr = [0, 1, 2, 3];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.every((v, i) => v === i)) [arr[0], arr[1]] = [arr[1], arr[0]];
    return arr;
  }

  function startDelayedHint(btn, timerKey, labelAfter, onUnlock) {
    clearInterval(state[timerKey]);
    let sec = 3;
    btn.disabled = true;
    btn.textContent = `${labelAfter} (${sec}s)`;
    state[timerKey] = setInterval(() => {
      sec -= 1;
      if (sec <= 0) {
        clearInterval(state[timerKey]);
        btn.disabled = false;
        btn.textContent = labelAfter;
        if (onUnlock) onUnlock();
      } else {
        btn.textContent = `${labelAfter} (${sec}s)`;
      }
    }, 1000);
  }

  function selectSentence(s) {
    state.currentSentence = s;
    state.forgeSlots = [null, null, null, null];
    state.forgeShuffled = shuffleIndices();
    state.dictRevealed = isSentenceDone(s);

    renderForgeList(false);
    $('forgeLevelTag').textContent = `JLPT N${s.level}`;
    $('forgeSourceTag').textContent = s.source;

    const isDict = state.forgeMode === 'dictation';
    $('forgeStage').classList.toggle('hidden', isDict);
    $('dictationStage').classList.toggle('hidden', !isDict);

    if (isDict) {
      $('dictInput').value = '';
      $('dictKanaPreview').textContent = '';
      $('dictResultBox').classList.add('hidden');
      $('dictHintText').classList.add('hidden');
      startDelayedHint($('dictHintBtn'), 'dictHintTimer', 'Gợi ý nghĩa & độ dài');
    } else {
      $('forgeResultBox').classList.add('hidden');
      $('forgeHintText').classList.add('hidden');
      startDelayedHint($('forgeHintBtn'), 'forgeHintTimer', 'Xem nghĩa tiếng Việt');
      renderForgeBuilder();
    }

    renderForgeKanjiPanel();
  }

  function renderForgeBuilder(checked = false) {
    const s = state.currentSentence;
    if (!s) return;

    const box = $('forgeSentenceBox');
    box.innerHTML = '';
    if (s.prefix) box.appendChild(buildInteractiveJpFragment(s.prefix));

    state.forgeSlots.forEach((chunkIdx, slotPos) => {
      const slotBtn = document.createElement('button');
      slotBtn.type = 'button';
      slotBtn.className = 'forge-slot';
      if (slotPos === s.starIdx) slotBtn.classList.add('star');
      if (chunkIdx !== null) {
        slotBtn.classList.add('filled');
        slotBtn.textContent = s.chunks[chunkIdx];
        if (checked) {
          slotBtn.classList.add(chunkIdx === slotPos ? 'correct' : 'wrong');
        }
      } else {
        slotBtn.textContent = slotPos === s.starIdx ? '★' : `Ô ${slotPos + 1}`;
      }
      slotBtn.addEventListener('click', () => {
        if (chunkIdx !== null) {
          state.forgeSlots[slotPos] = null;
          $('forgeResultBox').classList.add('hidden');
          renderForgeBuilder(false);
        }
      });
      box.appendChild(slotBtn);
    });

    if (s.suffix) box.appendChild(buildInteractiveJpFragment(s.suffix));

    const tray = $('forgeTray');
    tray.innerHTML = '';
    const used = new Set(state.forgeSlots.filter((v) => v !== null));
    state.forgeShuffled.forEach((chunkIdx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'forge-chunk-btn';
      if (used.has(chunkIdx)) b.classList.add('used');
      b.textContent = s.chunks[chunkIdx];
      b.addEventListener('click', () => {
        const emptySlot = state.forgeSlots.indexOf(null);
        if (emptySlot === -1) return;
        state.forgeSlots[emptySlot] = chunkIdx;
        renderForgeBuilder(false);
      });
      tray.appendChild(b);
    });
  }

  function checkSentenceForge() {
    const s = state.currentSentence;
    if (!s) return;
    const resEl = $('forgeResultBox');
    resEl.classList.remove('hidden', 'ok', 'warn');

    if (state.forgeSlots.some((v) => v === null)) {
      resEl.classList.add('warn');
      resEl.textContent = 'Hãy lắp đủ cả 4 mảnh vào 4 ô trống trước khi kiểm tra.';
      return;
    }

    const allRight = state.forgeSlots.every((v, i) => v === i);
    renderForgeBuilder(true);
    playWoodTap(allRight);

    if (allRight) {
      resEl.classList.add('ok');
      state.progress.sentencesDone = state.progress.sentencesDone || {};
      const prev = state.progress.sentencesDone[s.id] || {};
      prev.forge = true;
      prev.updatedAt = new Date().toISOString();
      state.progress.sentencesDone[s.id] = prev;
      scheduleSaveProgress(true);
      renderForgeList(false);
      speakJapaneseText(s.fullJp, 0.88);
    } else {
      resEl.classList.add('warn');
    }

    resEl.innerHTML = `
      <div><strong>${allRight ? 'Chính xác tuyệt đối!' : 'Chưa đúng trật tự câu.'}</strong> Bấm vào ô sai để trả mảnh về khay.</div>
      ${allRight ? `<div style="margin-top:6px;"><strong>Câu chuẩn:</strong> ${s.fullJp}</div>
      <div><strong>Nghĩa:</strong> ${s.vi}</div>
      <div style="margin-top:4px;color:var(--ink-secondary);"><strong>Ngữ pháp:</strong> ${s.grammarNote}</div>` : ''}
    `;
  }

  function normalizeJpForDiff(str) {
    return toHiragana((str || '').replace(/[\s。、「」『』？！!?.,]/g, ''));
  }

  function convertDictationInput(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    // If input contains pure ASCII romaji words, convert token-by-token so "n ni" becomes "んに"
    if (/^[a-zA-Z0-9\s'\-.,!?]+$/.test(trimmed)) {
      return trimmed.split(/\s+/).map((tok) => romajiToHiragana(tok)).join('');
    }
    return trimmed;
  }

  function buildCharDiffHtml(expected, actual) {
    const a = Array.from(expected);
    const b = Array.from(actual);
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    let matches = 0;
    let html = '';
    while (i < m) {
      if (j < n && a[i] === b[j]) {
        html += `<span class="diff-ok">${a[i]}</span>`;
        matches += 1;
        i += 1;
        j += 1;
      } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
        j += 1;
      } else {
        html += `<span class="diff-miss">${a[i]}</span>`;
        i += 1;
      }
    }
    return { html, accuracy: m ? Math.round((matches / m) * 100) : 0 };
  }

  function checkBlindDictation() {
    const s = state.currentSentence;
    if (!s) return;
    const raw = $('dictInput').value.trim();
    if (!raw) return;

    const converted = convertDictationInput(raw);
    const normUser = normalizeJpForDiff(converted);
    const normKana = normalizeJpForDiff(s.kana);
    const normFull = normalizeJpForDiff(s.fullJp);

    // Compare against kana if user entered hiragana/romaji, else best of fullJp vs kana
    const diffKana = buildCharDiffHtml(normKana, normUser);
    const diffFull = buildCharDiffHtml(normFull, normUser);
    const best = diffFull.accuracy > diffKana.accuracy ? diffFull : diffKana;

    state.dictRevealed = true;
    const passed = best.accuracy >= 80;
    playWoodTap(passed);

    const resEl = $('dictResultBox');
    resEl.classList.remove('hidden', 'ok', 'warn');
    resEl.classList.add(passed ? 'ok' : 'warn');
    $('dictDiffStrip').innerHTML = `${best.html} <span class="mono" style="font-size:13px;margin-left:8px;">(${best.accuracy}% khớp)</span>`;
    $('dictOriginalPanel').innerHTML = `
      <div><strong>Câu gốc:</strong> ${s.fullJp}</div>
      <div><strong>Kana:</strong> ${s.kana}</div>
      <div><strong>Nghĩa:</strong> ${s.vi}</div>
      <div style="color:var(--ink-secondary);"><strong>Ngữ pháp:</strong> ${s.grammarNote}</div>
    `;

    if (passed) {
      state.progress.sentencesDone = state.progress.sentencesDone || {};
      const prev = state.progress.sentencesDone[s.id] || {};
      prev.dictation = true;
      prev.updatedAt = new Date().toISOString();
      state.progress.sentencesDone[s.id] = prev;
      scheduleSaveProgress(true);
      renderForgeList(false);
    }

    renderForgeKanjiPanel();
  }

  function renderForgeKanjiPanel() {
    const s = state.currentSentence;
    if (!s) return;
    const locked = state.forgeMode === 'dictation' && !state.dictRevealed;
    $('forgeKanjiLockBanner').classList.toggle('hidden', !locked);
    $('forgeKanjiChips').classList.toggle('hidden', locked);

    if (locked) {
      $('forgeKanjiCount').textContent = 'Đang ẩn';
      $('fkEmptyHint').classList.remove('hidden');
      $('fkBody').classList.add('hidden');
      $('fkLevelTag').classList.add('hidden');
      return;
    }

    const kanjiChars = extractKanjiChars(s.fullJp);
    $('forgeKanjiCount').textContent = `${kanjiChars.length} chữ`;
    const chipsEl = $('forgeKanjiChips');
    chipsEl.innerHTML = '';
    kanjiChars.forEach((ch) => {
      const meta = state.kanjiLookup[ch];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'related-chip';
      chip.innerHTML = `<span class="related-chip-glyph">${ch}</span><span>${meta.hv}</span><span class="related-chip-lvl">N${meta.l}</span>`;
      chip.addEventListener('click', () => inspectForgeKanji(ch));
      chipsEl.appendChild(chip);
    });

    if (kanjiChars.length) {
      inspectForgeKanji(kanjiChars[0]);
    } else {
      $('fkEmptyHint').classList.remove('hidden');
      $('fkBody').classList.add('hidden');
    }
  }

  async function inspectForgeKanji(ch) {
    state.forgeSelectedKanji = ch;
    await renderMiniKanjiInspector(ch, 'fk');
  }

  function navigateSentence(delta) {
    const list = state.sentences.filter((s) => s.level === state.currentLevel);
    if (!list.length || !state.currentSentence) return;
    const idx = list.findIndex((s) => s.id === state.currentSentence.id);
    const nextIdx = Math.max(0, Math.min(list.length - 1, (idx === -1 ? 0 : idx) + delta));
    selectSentence(list[nextIdx]);
  }

  // =======================================================================
  // EXAM & CHOUKAI STUDIO (de_thi/ 2010–2026)
  // =======================================================================
  async function ensureExamsLoaded() {
    if (state.examsLoaded) return;
    const res = await fetch('data/exam-catalog.json');
    state.examCatalog = await res.json();
    state.examsLoaded = true;
  }

  function isExamDone(examId) {
    return Boolean(state.progress.examNotes && state.progress.examNotes[examId]?.done);
  }

  function renderExamList(autoPick = false) {
    const container = $('examList');
    const q = state.examSearch.trim().toLowerCase();
    const allForLevel = state.examCatalog.filter((ex) => ex.level === state.currentLevel);
    const filtered = allForLevel.filter((ex) => {
      if (state.examFilter === 'done' && !isExamDone(ex.id)) return false;
      if (state.examFilter === 'todo' && isExamDone(ex.id)) return false;
      if (q && !ex.title.toLowerCase().includes(q) && !ex.period.toLowerCase().includes(q)) return false;
      return true;
    });

    $('examListMeta').textContent = `N${state.currentLevel}: ${filtered.length} / ${allForLevel.length} kỳ thi`;
    container.innerHTML = '';

    if (!filtered.length) {
      container.innerHTML = '<div class="rk-empty">Không tìm thấy kỳ thi phù hợp.</div>';
      return;
    }

    filtered.forEach((ex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kanji-item';
      if (state.currentExam && state.currentExam.id === ex.id) btn.classList.add('active');
      const done = isExamDone(ex.id);
      const tags = [];
      if (ex.examPdfs.length) tags.push('Đề PDF');
      if (ex.audioFiles.length) tags.push('Audio');
      if (ex.scriptPdfs.length) tags.push('Script');
      if (ex.answerFiles.length) tags.push('Đáp án');
      btn.innerHTML = `
        <span class="kanji-item-glyph" style="font-size:14px;">${ex.year || 'N' + ex.level}</span>
        <span class="kanji-item-body">
          <div class="kanji-item-hv">${ex.title}</div>
          <div class="kanji-item-vi">${tags.join(' · ')}</div>
        </span>
        <span class="kanji-item-dot ${done ? 'mastered' : ''}"></span>
      `;
      btn.addEventListener('click', () => selectExam(ex));
      container.appendChild(btn);
    });

    if (autoPick || !state.currentExam || state.currentExam.level !== state.currentLevel) {
      selectExam(filtered[0]);
    }
  }

  function openExamDoc(fileItem, isGuard) {
    const pdfFrame = $('examPdfFrame');
    const imgViewer = $('examImgViewer');
    const emptyDoc = $('examEmptyDoc');
    const newTabLink = $('examOpenNewTabLink');
    $('tbInteractivePane').classList.add('hidden');
    state.tbInteractiveOpen = false;
    $('examGuardBanner').classList.toggle('hidden', !isGuard);

    if (!fileItem) {
      pdfFrame.classList.add('hidden');
      imgViewer.classList.add('hidden');
      emptyDoc.classList.remove('hidden');
      newTabLink.classList.add('hidden');
      return;
    }

    const encodedUrl = encodeUrlPath(fileItem.url);
    emptyDoc.classList.add('hidden');
    newTabLink.href = encodedUrl;
    newTabLink.classList.remove('hidden');

    if (/\.(jpg|jpeg|jpge|png)$/i.test(fileItem.name)) {
      pdfFrame.classList.add('hidden');
      imgViewer.src = encodedUrl;
      imgViewer.classList.remove('hidden');
    } else {
      imgViewer.classList.add('hidden');
      pdfFrame.src = encodedUrl;
      pdfFrame.classList.remove('hidden');
    }
  }

  function openPdfAtPage(fileUrl, pageNum, isGuard) {
    const pdfFrame = $('examPdfFrame');
    const imgViewer = $('examImgViewer');
    const emptyDoc = $('examEmptyDoc');
    const newTabLink = $('examOpenNewTabLink');

    $('tbInteractivePane').classList.add('hidden');
    state.tbInteractiveOpen = false;
    $('examGuardBanner').classList.toggle('hidden', !isGuard);
    emptyDoc.classList.add('hidden');
    imgViewer.classList.add('hidden');

    const encodedUrl = encodeUrlPath(fileUrl);
    const targetSrc = pageNum ? `${encodedUrl}#page=${pageNum}` : encodedUrl;
    newTabLink.href = targetSrc;
    newTabLink.classList.remove('hidden');

    // Reset frame briefly so Chromium PDF Viewer always scrolls to #page=N
    pdfFrame.classList.remove('hidden');
    pdfFrame.src = 'about:blank';
    setTimeout(() => {
      pdfFrame.src = targetSrc;
    }, 30);
  }

  function getActiveExamDocId() {
    if (state.examMode === 'textbook') {
      if (state.activeTextbookId === 'mimi-n3') {
        return state.currentMimiItem ? state.currentMimiItem.id : null;
      }
      return state.currentTextbookLesson ? state.currentTextbookLesson.id : 'chukyu-guide';
    }
    return state.currentExam ? state.currentExam.id : null;
  }

  function syncExamNotesPanel(docId, doneLabel = 'Đánh dấu đã giải xong đề này', undoneLabel = 'Đã giải xong (Bấm để bỏ đánh dấu)') {
    const saved = (docId && state.progress.examNotes && state.progress.examNotes[docId]) || {};
    $('examNoteInput').value = saved.note || '';
    $('examNoteSaveHint').textContent = 'Tự lưu ổ đĩa';
    $('examToggleDoneBtn').textContent = saved.done ? undoneLabel : doneLabel;
  }

  function selectExam(exam) {
    state.currentExam = exam;
    $('tbSectionBar').classList.add('hidden');
    $('tbLessonKanjiSection').classList.add('hidden');
    $('tbMimiUnitInfoSection')?.classList.add('hidden');
    $('tbTrackPairRow').classList.add('hidden');

    qsa('#examList .kanji-item').forEach((el) => {
      el.classList.toggle('active', el.querySelector('.kanji-item-hv')?.textContent === exam.title);
    });

    $('examCurrentTitle').textContent = exam.title;
    $('examCurrentSub').textContent = `Cấp độ JLPT N${exam.level} · Đang tải từ thư mục de_thi/ cục bộ`;

    const tabsEl = $('examFileTabs');
    tabsEl.innerHTML = '';
    const docButtons = [];

    exam.examPdfs.forEach((f, i) => docButtons.push({ label: exam.examPdfs.length > 1 ? `Đề thi ${i + 1}` : 'Đề thi PDF', file: f, guard: false }));
    exam.scriptPdfs.forEach((f, i) => docButtons.push({ label: exam.scriptPdfs.length > 1 ? `Script Nghe ${i + 1}` : 'Script Nghe', file: f, guard: true }));
    exam.answerFiles.forEach((f, i) => docButtons.push({ label: exam.answerFiles.length > 1 ? `Đáp án ${i + 1}` : 'Đáp án', file: f, guard: true }));

    docButtons.forEach((item, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `exam-file-btn${item.guard ? ' guard' : ''}${idx === 0 ? ' active' : ''}`;
      b.textContent = `${item.label} (${item.file.sizeMb} MB)`;
      b.addEventListener('click', () => {
        qsa('.exam-file-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        openExamDoc(item.file, item.guard);
      });
      tabsEl.appendChild(b);
    });

    openExamDoc(docButtons[0]?.file || null, docButtons[0]?.guard || false);

    const audioBar = $('examAudioBar');
    const audioEl = $('examAudioEl');
    audioEl.pause();
    if (exam.audioFiles.length) {
      audioBar.classList.remove('hidden');
      setAudioTrackSource(audioEl, exam.audioFiles[0].url, $('examPlayPauseBtn'), $('examAudioSeek'), $('examAudioTime'), false);
      audioEl.playbackRate = Number($('examSpeedSelect').value) || 1;
    } else {
      audioBar.classList.add('hidden');
      setAudioTrackSource(audioEl, '', $('examPlayPauseBtn'), $('examAudioSeek'), $('examAudioTime'), false);
    }

    syncExamNotesPanel(exam.id);
  }

  // --- Textbook Studio Mode (tai_lieu_tieng_nhat/) ---
  async function switchExamMode(mode) {
    state.examMode = mode;
    qsa('.exam-mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.emode === mode));
    const isTb = mode === 'textbook';
    $('tbBookSwitchRow')?.classList.toggle('hidden', !isTb);
    $('examSearchInput').classList.toggle('hidden', isTb);
    $('examFilterRow').classList.toggle('hidden', isTb);

    if (isTb) {
      await switchTextbookBook(state.activeTextbookId || 'chukyu', true);
    } else {
      $('tbMimiStepRow')?.classList.add('hidden');
      $('tbPageJumpForm')?.classList.add('hidden');
      $('tbMimiUnitInfoSection')?.classList.add('hidden');
      $('tbSectionBar').classList.add('hidden');
      $('tbLessonKanjiSection').classList.add('hidden');
      $('tbTrackPairRow').classList.add('hidden');
      $('tbInteractivePane').classList.add('hidden');
      state.tbInteractiveOpen = false;
      renderExamList(true);
    }
  }

  async function switchTextbookBook(bookId, autoPick = true) {
    state.activeTextbookId = bookId;
    qsa('.tb-book-btn').forEach((b) => b.classList.toggle('active', b.dataset.tbbook === bookId));
    const isMimi = bookId === 'mimi-n3';

    $('tbMimiStepRow')?.classList.toggle('hidden', !isMimi);
    $('tbPageJumpForm')?.classList.toggle('hidden', !isMimi);

    if (!isMimi) {
      $('tbMimiUnitInfoSection')?.classList.add('hidden');
      await ensureTextbookLoaded();
      renderTextbookList(autoPick);
      return;
    }

    $('tbLessonKanjiSection').classList.add('hidden');
    $('tbTrackPairRow').classList.add('hidden');
    $('examAudioBar').classList.add('hidden');
    $('examAudioEl')?.pause?.();
    $('tbInteractivePane').classList.add('hidden');
    state.tbInteractiveOpen = false;
    await ensureMimiBookLoaded();
    renderMimiUnitList(autoPick);
  }

  function renderMimiUnitList(autoPick = false) {
    const container = $('examList');
    const book = state.mimiBookData;
    if (!book || !Array.isArray(book.units)) {
      $('examListMeta').textContent = 'Chưa nạp dữ liệu 耳から N3';
      container.innerHTML = '<div class="rk-empty">Không tìm thấy data/mimi-n3-book.json.</div>';
      return;
    }

    const allUnits = book.units;
    const stepFilter = state.mimiStepFilter || 'all';
    const units = stepFilter === 'all' ? allUnits : allUnits.filter((u) => String(u.step) === stepFilter);
    const doneTotal = allUnits.filter((u) => isExamDone(u.id)).length;
    $('examListMeta').textContent = `${units.length} Unit${stepFilter !== 'all' ? ` (Step ${stepFilter})` : ' · 880 từ'} · Đã xong ${doneTotal}/${allUnits.length}`;
    container.innerHTML = '';

    units.forEach((u) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kanji-item';
      btn.dataset.mimiId = u.id;
      if (state.currentMimiItem && state.currentMimiItem.id === u.id) btn.classList.add('active');
      const done = isExamDone(u.id);
      const uBadge = `U${String(u.unitNum).padStart(2, '0')}`;
      btn.innerHTML = `
        <span class="kanji-item-glyph" style="font-size:13px;">${uBadge}</span>
        <span class="kanji-item-body">
          <div class="kanji-item-hv">${u.titleJp} — ${u.titleVi}</div>
          <div class="kanji-item-vi">Step ${u.step} · ${u.wordRange} (${u.wordCount} từ)</div>
        </span>
        <span class="kanji-item-dot ${done ? 'mastered' : ''}"></span>
      `;
      btn.addEventListener('click', () => selectMimiUnit(u));
      container.appendChild(btn);
    });

    const refBtn = document.createElement('button');
    refBtn.type = 'button';
    refBtn.className = 'kanji-item';
    refBtn.dataset.mimiId = 'mimi-n3-ref';
    if (state.currentMimiItem && state.currentMimiItem.id === 'mimi-n3-ref') refBtn.classList.add('active');
    const refDone = isExamDone('mimi-n3-ref');
    refBtn.innerHTML = `
      <span class="kanji-item-glyph" style="font-size:12px;">50音</span>
      <span class="kanji-item-body">
        <div class="kanji-item-hv">語彙索引 (Tra cứu 50 âm)</div>
        <div class="kanji-item-vi">Mục lục · Lời tựa · Index Tr.206 · Đáp án</div>
      </span>
      <span class="kanji-item-dot ${refDone ? 'mastered' : ''}"></span>
    `;
    refBtn.addEventListener('click', () => selectMimiReference());
    container.appendChild(refBtn);

    if (autoPick) {
      const keep = state.currentMimiItem
        ? (state.currentMimiItem.id === 'mimi-n3-ref'
            ? { isRef: true }
            : units.find((u) => u.id === state.currentMimiItem.id))
        : null;
      if (keep && keep.isRef) {
        selectMimiReference();
      } else {
        selectMimiUnit(keep || units[0]);
      }
    }
  }

  function renderMimiSidebarInfo(unitOrNull) {
    const sec = $('tbMimiUnitInfoSection');
    const book = state.mimiBookData;
    if (!sec || !book) return;
    sec.classList.remove('hidden');

    const allUnits = book.units || [];
    const doneCount = allUnits.filter((u) => isExamDone(u.id)).length;
    if ($('tbMimiUnitProgress')) {
      $('tbMimiUnitProgress').textContent = `${doneCount} / ${allUnits.length} Unit`;
    }

    const summaryEl = $('tbMimiUnitSummary');
    const metaEl = $('tbMimiColMeta');
    const colBox = $('tbMimiColumnsList');
    if (!summaryEl || !colBox) return;

    if (!unitOrNull) {
      summaryEl.innerHTML = `
        <span class="tb-mimi-pill">880 từ cốt lõi</span>
        <span class="tb-mimi-pill">22 Column (~520 từ)</span>
        <span class="tb-mimi-pill">PDF = tr.sách + 1</span>
      `;
      if (metaEl) metaEl.textContent = 'Mở nhanh các phần tham chiếu của sách:';
      colBox.innerHTML = '';
      const refs = [
        { label: '📖 Lời tựa & Hướng dẫn', bookPage: book.refPages.introBookPage, page: book.refPages.intro },
        { label: '📋 Mục lục sách', bookPage: book.refPages.tocBookPage, page: book.refPages.toc },
        { label: '📑 語彙索引 (Tra cứu 50 âm)', bookPage: book.refPages.indexBookPage, page: book.refPages.index },
        { label: '✅ Bìa Đáp án (解答)', bookPage: 224, page: book.refPages.answersCover, guard: true },
      ];
      refs.forEach((r) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tb-mimi-col-btn';
        b.innerHTML = `<span>${r.label}</span><span class="mono sub-hint">PDF ${r.page}</span>`;
        b.addEventListener('click', () => {
          colBox.querySelectorAll('.tb-mimi-col-btn').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          openPdfAtPage(book.pdfUrl, r.page, Boolean(r.guard));
        });
        colBox.appendChild(b);
      });
      return;
    }

    summaryEl.innerHTML = `
      <span class="tb-mimi-pill">Step ${unitOrNull.step}</span>
      <span class="tb-mimi-pill">${unitOrNull.wordRange} (${unitOrNull.wordCount} từ)</span>
      <span class="tb-mimi-pill">${unitOrNull.cdRange}</span>
      <span class="tb-mimi-pill">Tr.${unitOrNull.vocabBookPage} (PDF ${unitOrNull.vocabPage})</span>
    `;
    colBox.innerHTML = '';
    const cols = Array.isArray(unitOrNull.columns) ? unitOrNull.columns : [];
    if (!cols.length) {
      if (metaEl) metaEl.textContent = 'Unit này không có khung Column phụ — tập trung trọn 100 từ B.';
      return;
    }

    if (metaEl) metaEl.textContent = `Mở nhanh ${cols.length} mục Column / まとめ của Unit ${String(unitOrNull.unitNum).padStart(2, '0')}:`;
    cols.forEach((col) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-mimi-col-btn';
      b.innerHTML = `<span>📌 ${col.label}</span><span class="mono sub-hint">Tr.${col.bookPage}</span>`;
      b.addEventListener('click', () => {
        colBox.querySelectorAll('.tb-mimi-col-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        $('tbSectionBar').querySelectorAll('.tb-sec-btn').forEach((x) => x.classList.remove('active'));
        openPdfAtPage(book.pdfUrl, col.page, false);
      });
      colBox.appendChild(b);
    });
  }

  function selectMimiUnit(unit) {
    const book = state.mimiBookData;
    if (!book || !unit) return;
    window.MediaCoach?.pauseAll?.();
    state.currentMimiItem = unit;

    qsa('#examList .kanji-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.mimiId === unit.id);
    });

    $('examFileTabs').innerHTML = '';
    $('examAudioBar').classList.add('hidden');
    $('examAudioEl')?.pause?.();
    $('tbTrackPairRow').classList.add('hidden');
    $('tbLessonKanjiSection').classList.add('hidden');

    const uStr = String(unit.unitNum).padStart(2, '0');
    $('examCurrentTitle').textContent = `Unit ${uStr}: ${unit.titleJp} (${unit.titleVi})`;
    $('examCurrentSub').textContent = `耳から覚える N3 · Step ${unit.step} · ${unit.wordRange} (${unit.wordCount} từ) · ${unit.cdRange}`;
    if ($('tbPageJumpInput')) $('tbPageJumpInput').placeholder = String(unit.vocabBookPage);

    const secBar = $('tbSectionBar');
    secBar.classList.remove('hidden');
    secBar.innerHTML = '';

    const sections = [
      { label: `📖 Từ vựng (Tr.${unit.vocabBookPage})`, page: unit.vocabPage, guard: false },
    ];
    (unit.practice1 || []).forEach((p) => {
      sections.push({ label: `${p.label} (Tr.${p.bookPage})`, page: p.page, guard: false });
    });
    if (unit.practice2) {
      sections.push({ label: `${unit.practice2.label} (Tr.${unit.practice2.bookPage})`, page: unit.practice2.page, guard: false });
    }
    sections.push({ label: `📑 Index 50 âm (Tr.${book.refPages.indexBookPage})`, page: book.refPages.index, guard: false });
    (unit.answers || []).forEach((a) => {
      sections.push({ label: a.label, page: a.page, guard: true });
    });

    sections.forEach((sec, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tb-sec-btn${sec.guard ? ' guard' : ''}${idx === 0 ? ' active' : ''}`;
      b.textContent = sec.label;
      b.addEventListener('click', () => {
        secBar.querySelectorAll('.tb-sec-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        $('tbMimiColumnsList')?.querySelectorAll('.tb-mimi-col-btn').forEach((x) => x.classList.remove('active'));
        openPdfAtPage(book.pdfUrl, sec.page, Boolean(sec.guard));
      });
      secBar.appendChild(b);
    });

    openPdfAtPage(book.pdfUrl, unit.vocabPage, false);
    renderMimiSidebarInfo(unit);
    syncExamNotesPanel(unit.id, 'Đánh dấu đã học xong Unit này', 'Đã học xong Unit này (Bấm để bỏ đánh dấu)');
  }

  function selectMimiReference() {
    const book = state.mimiBookData;
    if (!book) return;
    window.MediaCoach?.pauseAll?.();
    state.currentMimiItem = { id: 'mimi-n3-ref', isRef: true };

    qsa('#examList .kanji-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.mimiId === 'mimi-n3-ref');
    });

    $('examFileTabs').innerHTML = '';
    $('examAudioBar').classList.add('hidden');
    $('examAudioEl')?.pause?.();
    $('tbTrackPairRow').classList.add('hidden');
    $('tbLessonKanjiSection').classList.add('hidden');

    $('examCurrentTitle').textContent = '語彙索引 — Mục lục & Tra cứu 50 âm (耳から N3)';
    $('examCurrentSub').textContent = 'Tra nhanh hơn 1.400 từ (880 từ cốt lõi + ~520 từ Column) theo bảng chữ 50 âm kèm ô tự kiểm □';
    if ($('tbPageJumpInput')) $('tbPageJumpInput').placeholder = String(book.refPages.indexBookPage);

    const secBar = $('tbSectionBar');
    secBar.classList.remove('hidden');
    secBar.innerHTML = '';

    const sections = [
      { label: `📑 Index 50 âm (Tr.${book.refPages.indexBookPage})`, page: book.refPages.index, guard: false },
      { label: `📋 Mục lục (Tr.${book.refPages.tocBookPage})`, page: book.refPages.toc, guard: false },
      { label: `📖 Lời tựa (Tr.${book.refPages.introBookPage})`, page: book.refPages.intro, guard: false },
      { label: '✅ Bìa Đáp án (解答)', page: book.refPages.answersCover, guard: true },
    ];
    sections.forEach((sec, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tb-sec-btn${sec.guard ? ' guard' : ''}${idx === 0 ? ' active' : ''}`;
      b.textContent = sec.label;
      b.addEventListener('click', () => {
        secBar.querySelectorAll('.tb-sec-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        openPdfAtPage(book.pdfUrl, sec.page, Boolean(sec.guard));
      });
      secBar.appendChild(b);
    });

    openPdfAtPage(book.pdfUrl, book.refPages.index, false);
    renderMimiSidebarInfo(null);
    syncExamNotesPanel('mimi-n3-ref', 'Đánh dấu đã rà soát bảng tra cứu', 'Đã rà soát (Bấm để bỏ đánh dấu)');
  }

  function renderTextbookList(autoPick = false) {
    const container = $('examList');
    const tb = state.textbookData;
    if (!tb || !tb.lessons) {
      $('examListMeta').textContent = 'Chưa nạp dữ liệu sách';
      container.innerHTML = '<div class="rk-empty">Không tìm thấy data/textbooks.json.</div>';
      return;
    }

    $('examListMeta').textContent = `${tb.lessons.length} Bài học · 55 Ngữ pháp · 169 Kanji`;
    container.innerHTML = '';

    tb.lessons.forEach((ls) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kanji-item';
      btn.dataset.lessonId = ls.id;
      if (state.currentTextbookLesson && state.currentTextbookLesson.id === ls.id) btn.classList.add('active');
      const done = isExamDone(ls.id);
      btn.innerHTML = `
        <span class="kanji-item-glyph" style="font-size:14px;">B${ls.lessonNum}</span>
        <span class="kanji-item-body">
          <div class="kanji-item-hv">${ls.titleJp}</div>
          <div class="kanji-item-vi">${ls.titleVi} · ${ls.kanjiChars.length} Kanji</div>
        </span>
        <span class="kanji-item-dot ${done ? 'mastered' : ''}"></span>
      `;
      btn.addEventListener('click', () => selectTextbookLesson(ls));
      container.appendChild(btn);
    });

    // Teacher guide item at the bottom
    const guideBtn = document.createElement('button');
    guideBtn.type = 'button';
    guideBtn.className = 'kanji-item';
    guideBtn.dataset.lessonId = 'chukyu-guide';
    if (!state.currentTextbookLesson && state.examMode === 'textbook') guideBtn.classList.add('active');
    const guideDone = isExamDone('chukyu-guide');
    guideBtn.innerHTML = `
      <span class="kanji-item-glyph" style="font-size:13px;">GV</span>
      <span class="kanji-item-body">
        <div class="kanji-item-hv">教師用ガイド (Sách GV)</div>
        <div class="kanji-item-vi">30 trang hướng dẫn giảng dạy &amp; bảng từ</div>
      </span>
      <span class="kanji-item-dot ${guideDone ? 'mastered' : ''}"></span>
    `;
    guideBtn.addEventListener('click', () => selectTeacherGuide());
    container.appendChild(guideBtn);

    if (autoPick) {
      selectTextbookLesson(state.currentTextbookLesson || tb.lessons[0]);
    }
  }

  function renderTextbookInteractivePane(ls) {
    window.MediaCoach?.pauseAll?.();
    const pane = $('tbInteractivePane');
    const answersList = [];
    const htmlCloze = ls.listeningCloze
      .replace(/[\{\uff5b]([^\}\uff5d]+)[\}\uff5d]/g, (_, raw) => {
        const idx = answersList.length;
        const alts = raw.split(/[|｜]/).map((s) => s.trim()).filter(Boolean);
        answersList.push(alts);
        return `<input type="text" class="cloze-input" data-cloze-idx="${idx}" placeholder="( ${idx + 1} )" autocomplete="off" spellcheck="false" />`;
      })
      .replace(/\n/g, '<br />');

    const grammarCardsHtml = ls.grammar.map((g, i) => `
      <div class="grammar-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="grammar-pat">${i + 1}. ${g.pattern}</div>
          <button type="button" class="btn-ghost-sm tb-yg-gram-btn" data-gram-idx="${i}" title="Nghe mẫu ngữ pháp này trong câu nói thực tế (YouGlish JP)">🎬 YouGlish JP</button>
        </div>
        <div class="grammar-desc">${g.descVi}</div>
        <div class="grammar-ex"><strong>Ví dụ:</strong> ${g.exampleJp}<br /><span>→ ${g.exampleVi}</span></div>
      </div>
    `).join('');

    pane.innerHTML = `
      <h2 class="tb-block-title">🎧 Phiếu nghe điền từ: 聴解タスクシート (Bài ${ls.lessonNum}: ${ls.titleJp})</h2>
      <p class="sub-hint" style="margin:0 0 10px;">Bật Audio <strong>CD Chậm</strong> hoặc <strong>CD Tự nhiên</strong> ở thanh trên rồi nghe và điền từ vào chỗ trống (có thể gõ Kanji, Kana hoặc Romaji):</p>
      <div class="cloze-passage" id="tbClozePassage">${htmlCloze}</div>
      <div class="forge-actions" style="margin-bottom:18px;">
        <button type="button" class="btn-primary" id="tbClozeCheckBtn">Kiểm tra đáp án nghe</button>
        <button type="button" class="btn-ghost-sm" id="tbClozeRevealBtn">Mở đáp án điền</button>
        <button type="button" class="btn-ghost-sm" id="tbClozeClearBtn">Xóa làm lại</button>
        <span class="mono sub-hint" id="tbClozeScore"></span>
      </div>

      <h2 class="tb-block-title" style="margin-top:20px;">📘 Ngữ pháp trọng tâm Bài ${ls.lessonNum} (${ls.grammar.length} mẫu câu)</h2>
      <div id="tbMediaCoachMount"></div>
      <div class="grammar-cards">${grammarCardsHtml}</div>
    `;

    pane.querySelectorAll('.tb-yg-gram-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = ls.grammar[Number(btn.dataset.gramIdx)];
        if (!g) return;
        const cleanQuery = (g.pattern || '')
          .replace(/\[[^\]]*\]|（[^）]*）|\([^\)]*\)/g, '')
          .replace(/[A-Za-z0-9＋+\-・]+/g, ' ')
          .replace(/[〜～、。]/g, ' ')
          .trim()
          .split(/\s+/)
          .find((tok) => /[\u3040-\u30ff\u4e00-\u9faf]{2,}/.test(tok)) || g.exampleJp;
        window.MediaCoach?.openYouGlish(cleanQuery, 'japanese', '', 'tbMediaCoachMount');
      });
    });

    $('tbClozeCheckBtn').addEventListener('click', () => {
      const inputs = Array.from(pane.querySelectorAll('.cloze-input'));
      let okCount = 0;
      inputs.forEach((inp, idx) => {
        const userNorm = normalizeJpForDiff(convertDictationInput(inp.value));
        const validNorms = answersList[idx].map((a) => normalizeJpForDiff(a));
        const matched = userNorm.length > 0 && validNorms.includes(userNorm);
        inp.classList.toggle('ok', matched);
        inp.classList.toggle('wrong', !matched);
        if (matched) okCount += 1;
      });
      playWoodTap(okCount === inputs.length);
      $('tbClozeScore').textContent = `Đúng ${okCount} / ${inputs.length} ô`;
    });

    $('tbClozeRevealBtn').addEventListener('click', () => {
      const inputs = Array.from(pane.querySelectorAll('.cloze-input'));
      inputs.forEach((inp, idx) => {
        inp.value = answersList[idx][0];
        inp.classList.remove('wrong');
        inp.classList.add('ok');
      });
      $('tbClozeScore').textContent = 'Đã hiển thị toàn bộ đáp án chuẩn từ sách';
    });

    $('tbClozeClearBtn').addEventListener('click', () => {
      pane.querySelectorAll('.cloze-input').forEach((inp) => {
        inp.value = '';
        inp.classList.remove('ok', 'wrong');
      });
      $('tbClozeScore').textContent = '';
    });
  }

  function renderTextbookLessonKanji(ls) {
    $('tbLessonKanjiSection').classList.remove('hidden');
    const doneCnt = ls.kanjiChars.filter((c) => {
      const st = getKanjiStatus(c);
      return st === 'mastered' || st === 'learning';
    }).length;
    $('tbLessonKanjiMeta').textContent = `${doneCnt} / ${ls.kanjiChars.length} chữ đã luyện · Đồng bộ 2 chiều N5–N1`;

    const chips = $('tbLessonKanjiChips');
    chips.innerHTML = '';
    ls.kanjiChars.forEach((ch) => {
      const meta = state.kanjiLookup[ch];
      if (!meta) return;
      const st = getKanjiStatus(ch);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'related-chip';
      if (st === 'mastered') chip.style.borderColor = 'var(--accent-moss)';
      else if (st === 'due') chip.style.borderColor = 'var(--accent-vermilion)';
      chip.innerHTML = `<span class="related-chip-glyph">${ch}</span><span>${meta.hv}</span><span class="related-chip-lvl">N${meta.l}</span>`;
      chip.title = `${meta.hv} — ${meta.vi} (N${meta.l}) — Bấm để bóc tách bên dưới`;
      chip.addEventListener('click', () => {
        $('examQuickKanjiInput').value = ch;
        renderExamQuickKanji(ch);
      });
      chips.appendChild(chip);
    });
  }

  function selectTextbookLesson(ls) {
    window.MediaCoach?.pauseAll?.();
    state.currentTextbookLesson = ls;
    state.tbInteractiveOpen = false;
    qsa('#examList .kanji-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.lessonId === ls.id);
    });

    $('examFileTabs').innerHTML = '';
    $('examCurrentTitle').textContent = `Bài ${ls.lessonNum}: ${ls.titleJp} (${ls.titleVi})`;
    $('examCurrentSub').textContent = `Giáo trình 中級へ行こう · N${ls.level} · ${ls.kanjiChars.length} Kanji · ${ls.grammar.length} mẫu ngữ pháp`;

    // Build instant page-jump toolbar
    const secBar = $('tbSectionBar');
    secBar.classList.remove('hidden');
    secBar.innerHTML = '';
    const sections = [
      { key: 'honbun', label: `📖 Bài đọc (Tr.${ls.pages.honbun})`, page: ls.pages.honbun, guard: false },
      { key: 'grammar', label: `📘 Ngữ pháp TV (Tr.${ls.pages.grammar})`, page: ls.pages.grammar, guard: false },
      { key: 'listening', label: `🎧 Phiếu nghe (Tr.${ls.pages.listening})`, page: ls.pages.listening, guard: false },
      { key: 'kanji', label: `漢 Kanji bài (Tr.${ls.pages.kanji})`, page: ls.pages.kanji, guard: false },
      { key: 'vocabVi', label: `🇻🇳 Từ vựng TV (Tr.${ls.pages.vocabVi})`, page: ls.pages.vocabVi, guard: false },
      { key: 'answer', label: `✅ Đáp án (Tr.${ls.pages.answer})`, page: ls.pages.answer, guard: true },
    ];

    sections.forEach((sec, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tb-sec-btn${sec.guard ? ' guard' : ''}${idx === 0 ? ' active' : ''}`;
      b.textContent = sec.label;
      b.addEventListener('click', () => {
        secBar.querySelectorAll('.tb-sec-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        openPdfAtPage(state.textbookData.pdfUrl, sec.page, sec.guard);
      });
      secBar.appendChild(b);
    });

    const toggleInterBtn = document.createElement('button');
    toggleInterBtn.type = 'button';
    toggleInterBtn.id = 'tbToggleInteractiveBtn';
    toggleInterBtn.className = 'tb-sec-btn interactive';
    toggleInterBtn.textContent = '🎧 Nghe điền từ & Ngữ pháp';
    toggleInterBtn.addEventListener('click', () => {
      const willOpen = !state.tbInteractiveOpen;
      state.tbInteractiveOpen = willOpen;
      secBar.querySelectorAll('.tb-sec-btn').forEach((x) => x.classList.remove('active'));
      toggleInterBtn.classList.toggle('active', willOpen);
      if (willOpen) {
        $('examPdfFrame').classList.add('hidden');
        $('examImgViewer').classList.add('hidden');
        $('examEmptyDoc').classList.add('hidden');
        $('examGuardBanner').classList.add('hidden');
        renderTextbookInteractivePane(ls);
        $('tbInteractivePane').classList.remove('hidden');
      } else {
        const firstBtn = secBar.querySelector('.tb-sec-btn');
        if (firstBtn) firstBtn.classList.add('active');
        openPdfAtPage(state.textbookData.pdfUrl, ls.pages.honbun, false);
      }
    });
    secBar.appendChild(toggleInterBtn);

    // Load PDF directly to Lesson Honbun page
    openPdfAtPage(state.textbookData.pdfUrl, ls.pages.honbun, false);

    // Setup Dual-speed Audio Bar (Slow & Natural)
    $('examAudioBar').classList.remove('hidden');
    $('tbTrackPairRow').classList.remove('hidden');
    configureDualTrackButtons($('tbTrackSlowBtn'), $('tbTrackNatBtn'), 'slow');
    const audioEl = $('examAudioEl');
    setAudioTrackSource(audioEl, ls.audioSlow, $('examPlayPauseBtn'), $('examAudioSeek'), $('examAudioTime'), false);
    audioEl.playbackRate = Number($('examSpeedSelect').value) || 1;

    renderTextbookLessonKanji(ls);
    syncExamNotesPanel(ls.id, 'Đánh dấu đã học xong bài này', 'Đã học xong (Bấm để bỏ đánh dấu)');
  }

  function selectTeacherGuide() {
    state.currentTextbookLesson = null;
    $('tbSectionBar').classList.add('hidden');
    $('tbLessonKanjiSection').classList.add('hidden');
    $('tbTrackPairRow').classList.add('hidden');
    $('examAudioBar').classList.add('hidden');
    qsa('#examList .kanji-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.lessonId === 'chukyu-guide');
    });
    $('examCurrentTitle').textContent = '教師用ガイド — Sách Hướng dẫn Giáo viên';
    $('examCurrentSub').textContent = '30 trang mục tiêu từng bài, lưu ý ngữ pháp & bảng từ xuất hiện';
    openPdfAtPage(state.textbookData.guidePdfUrl, 1, false);
    syncExamNotesPanel('chukyu-guide', 'Đánh dấu đã xem xong hướng dẫn', 'Đã xem xong');
  }

  async function renderExamQuickKanji(query) {
    const container = $('examQuickKanjiResults');
    const raw = (query || '').trim();
    if (!raw) {
      container.innerHTML = '<span class="sub-hint">Nhập chữ Kanji (hoặc cả từ ghép như 構造) để bóc tách từng chữ Hán.</span>';
      return;
    }

    let chars = extractKanjiChars(raw);
    if (!chars.length) {
      const norm = stripVietnamese(raw);
      for (const [ch, meta] of Object.entries(state.kanjiLookup)) {
        if (stripVietnamese(meta.hv).includes(norm) || stripVietnamese(meta.vi).includes(norm)) {
          chars.push(ch);
          if (chars.length >= 10) break;
        }
      }
    }

    container.innerHTML = '';
    if (!chars.length) {
      container.innerHTML = '<span class="sub-hint">Không tìm thấy chữ Kanji khớp trong bộ 2.230 chữ N5–N1.</span>';
      return;
    }

    chars.slice(0, 10).forEach((ch) => {
      const meta = state.kanjiLookup[ch];
      const card = document.createElement('div');
      card.className = 'exam-quick-card';
      card.innerHTML = `
        <div class="exam-quick-left">
          <span class="exam-quick-glyph">${ch}</span>
          <div>
            <div class="comp-name">${meta.hv} <span class="related-chip-lvl">N${meta.l}</span></div>
            <div class="comp-meaning">${meta.vi}</div>
          </div>
        </div>
        <div style="display:flex;gap:4px;">
          <button type="button" class="btn-ghost-sm eq-srs">+ SRS</button>
          <button type="button" class="btn-ghost-sm eq-open">Viết</button>
        </div>
      `;
      card.querySelector('.eq-srs').addEventListener('click', (e) => {
        enqueueKanjiForSrs(ch);
        e.target.textContent = 'Đã thêm';
      });
      card.querySelector('.eq-open').addEventListener('click', () => jumpToKanji(ch));
      container.appendChild(card);
    });
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
        $('dojoSummaryCard').classList.add('hidden');
        $('dojoEmptyState').innerHTML = '<p>Hôm nay bạn không có chữ nào đến hạn ôn SRS. Hãy chọn <strong>"Ôn lại toàn bộ chữ đã học"</strong> hoặc <strong>"Chữ chưa thuộc ở cấp đang chọn"</strong>.</p>';
        return;
      }
    } else if (scope === 'learned') {
      const now = Date.now();
      chars = Object.entries(state.progress.kanji)
        .filter(([ch]) => Boolean(state.kanjiLookup[ch]))
        .sort((a, b) => {
          const da = a[1].due ? new Date(a[1].due).getTime() : now;
          const db = b[1].due ? new Date(b[1].due).getTime() : now;
          return da - db;
        })
        .map(([ch]) => ch);
      if (!chars.length) {
        $('dojoEmptyState').classList.remove('hidden');
        $('dojoCard').classList.add('hidden');
        $('dojoSummaryCard').classList.add('hidden');
        $('dojoEmptyState').innerHTML = '<p>Bạn chưa có chữ Kanji nào trong sổ tiến độ. Hãy luyện viết ở tab <strong>Xưởng chữ</strong> trước nhé.</p>';
        return;
      }
    } else if (scope === 'chukyu') {
      const tb = await ensureTextbookLoaded();
      const chukyuList = (tb && tb.allKanji) || [];
      const now = Date.now();
      chars = chukyuList
        .filter((ch) => state.kanjiLookup[ch] && getKanjiStatus(ch) !== 'mastered')
        .sort((a, b) => {
          const da = state.progress.kanji[a]?.due ? new Date(state.progress.kanji[a].due).getTime() : now + 86400000;
          const db = state.progress.kanji[b]?.due ? new Date(state.progress.kanji[b].due).getTime() : now + 86400000;
          return da - db;
        });
      if (!chars.length) {
        $('dojoEmptyState').classList.remove('hidden');
        $('dojoCard').classList.add('hidden');
        $('dojoSummaryCard').classList.add('hidden');
        $('dojoEmptyState').innerHTML = '<p>Chúc mừng! Toàn bộ 169 chữ Kanji trong giáo trình <strong>中級へ行こう</strong> đều đã đạt mức Thuộc sâu.</p>';
        return;
      }
    } else if (scope === 'leech') {
      chars = Object.entries(state.progress.kanji)
        .filter(([ch, rec]) => Boolean(state.kanjiLookup[ch]) && ((rec.ease || 2.5) < 2.35 || (rec.interval || 0) < 3))
        .sort((a, b) => (a[1].ease || 2.5) - (b[1].ease || 2.5))
        .map(([ch]) => ch);
      if (!chars.length) {
        $('dojoEmptyState').classList.remove('hidden');
        $('dojoCard').classList.add('hidden');
        $('dojoSummaryCard').classList.add('hidden');
        $('dojoEmptyState').innerHTML = '<p>Chưa có chữ nào thuộc nhóm điểm yếu (hay quên / chu kỳ ngắn). Rất tốt!</p>';
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
    state.dojoResults = [];
    $('dojoSummaryCard').classList.add('hidden');
    if (!entries.length) {
      $('dojoEmptyState').classList.remove('hidden');
      $('dojoCard').classList.add('hidden');
      return;
    }
    $('dojoEmptyState').classList.add('hidden');
    $('dojoCard').classList.remove('hidden');
    showDojoCard();
  }

  function renderDojoSummary() {
    $('dojoCard').classList.add('hidden');
    $('dojoEmptyState').classList.add('hidden');
    const summaryEl = $('dojoSummaryCard');
    summaryEl.classList.remove('hidden');

    const total = state.dojoResults.length;
    const goodCount = state.dojoResults.filter((r) => r.quality >= 3).length;
    const hardCount = state.dojoResults.filter((r) => r.quality <= 2).length;

    summaryEl.innerHTML = `
      <div class="section-head">
        <h2>Hoàn thành lượt ôn tập mù!</h2>
        <span class="mono sub-hint">${total} chữ đã đánh giá</span>
      </div>
      <div class="dojo-summary-stats">
        <div class="dojo-summary-pill"><strong>Nhớ tốt / Khắc cốt:</strong> <span style="color:var(--accent-moss);">${goodCount}</span></div>
        <div class="dojo-summary-pill"><strong>Cần rèn lại (Quên / Khó):</strong> <span style="color:var(--accent-vermilion);">${hardCount}</span></div>
      </div>
      <div class="sub-label">Bấm vào từng chữ bên dưới nếu muốn xem lại nét viết trong Xưởng chữ:</div>
      <div class="related-chips" id="dojoSummaryChips" style="margin-top:8px;"></div>
    `;
    const chipsBox = $('dojoSummaryChips');
    state.dojoResults.forEach((r) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'related-chip';
      if (r.quality <= 2) chip.style.borderColor = 'var(--accent-vermilion)';
      chip.innerHTML = `<span class="related-chip-glyph">${r.c}</span><span>${r.hv}</span><span class="related-chip-lvl">${r.quality <= 2 ? 'Ôn lại' : 'Đạt'}</span>`;
      chip.addEventListener('click', () => jumpToKanji(r.c));
      chipsBox.appendChild(chip);
    });
  }

  function showDojoCard() {
    const entry = state.dojoQueue[state.dojoIndex];
    if (!entry) {
      renderDojoSummary();
      return;
    }

    state.dojoCurrent = entry;
    $('dojoProgressText').textContent = `Thẻ ${state.dojoIndex + 1} / ${state.dojoQueue.length}`;
    $('dojoLevelTag').textContent = `JLPT N${entry.l} · ${entry.s} nét`;

    [1, 2, 3, 4].forEach((q) => {
      const el = document.querySelector(`[data-dojo-next="${q}"]`);
      if (el) el.textContent = previewNextInterval(entry.c, q);
    });

    const isTyping = state.dojoMode === 'typing';
    $('dojoBoardWrap').classList.toggle('hidden', isTyping);
    $('dojoTypingWrap').classList.toggle('hidden', !isTyping);

    if (isTyping) {
      $('dojoHv').textContent = 'Truy xuất từ mặt chữ Kanji';
      $('dojoVi').textContent = 'Nhìn mặt chữ bên dưới và gõ lại Âm Hán-Việt + Cách đọc On/Kun';
      $('dojoReadings').textContent = '';
      $('dojoTypingGlyph').textContent = entry.c;
      $('dojoInputHv').value = '';
      $('dojoInputRead').value = '';
      $('dojoKanaPreview').textContent = '';
      $('dojoTypingResult').classList.add('hidden');
      $('dojoInputHv').focus();
    } else {
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
  }

  function revealDojoTypingInfo(entry) {
    $('dojoHv').textContent = `${entry.c} — ${entry.hv}`;
    $('dojoVi').textContent = entry.vi.slice(0, 4).join(' · ') || entry.en.slice(0, 3).join(' · ');
    $('dojoReadings').textContent = `On: ${entry.on.join(', ') || '—'}   |   Kun: ${entry.kun.join(', ') || '—'}`;
  }

  function checkDojoTyping(e) {
    if (e) e.preventDefault();
    const entry = state.dojoCurrent;
    if (!entry) return;
    const { hvOk, readOk, readKana } = evaluateKanjiRecallTyping(
      entry,
      $('dojoInputHv').value,
      $('dojoInputRead').value
    );
    revealDojoTypingInfo(entry);

    const resEl = $('dojoTypingResult');
    resEl.classList.remove('hidden', 'ok', 'warn');
    if (hvOk && readOk) {
      playWoodTap(true);
      resEl.classList.add('ok');
      resEl.textContent = `Chính xác! ${entry.c} — ${entry.hv} | On: ${entry.on.join(', ') || '—'} | Kun: ${entry.kun.join(', ') || '—'}. Hãy chọn mức đánh giá SRS bên dưới.`;
      speakJapanese(entry);
    } else {
      playWoodTap(false);
      resEl.classList.add('warn');
      const parts = [];
      if (!hvOk) parts.push(`Hán-Việt đúng: ${entry.hv}`);
      if (!readOk) parts.push(`Kana chưa khớp (${readKana || 'trống'})`);
      resEl.textContent = `${parts.join(' · ')}. Đã mở đáp án ở trên, hãy chấm mức độ nhớ bên dưới.`;
    }
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
    if ($('statBlindAccuracy')) $('statBlindAccuracy').textContent = blindAcc;
    if ($('statTotalStrokes')) $('statTotalStrokes').textContent = `${s.totalStrokesDrawn || 0} nét chữ đã rèn`;

    const countsByLvl = {
      5: { mastered: 0, learning: 0, total: LEVEL_COUNTS[5] },
      4: { mastered: 0, learning: 0, total: LEVEL_COUNTS[4] },
      3: { mastered: 0, learning: 0, total: LEVEL_COUNTS[3] },
      2: { mastered: 0, learning: 0, total: LEVEL_COUNTS[2] },
      1: { mastered: 0, learning: 0, total: LEVEL_COUNTS[1] },
    };

    let jpMasteredSum = 0;
    const jpTouched = Object.keys(state.progress.kanji || {}).length;
    for (const [ch] of Object.entries(state.progress.kanji || {})) {
      const lvl = state.kanjiLookup[ch]?.l;
      if (!lvl) continue;
      const st = getKanjiStatus(ch);
      if (st === 'mastered') {
        countsByLvl[lvl].mastered += 1;
        jpMasteredSum += 1;
      } else if (st === 'learning' || st === 'due') {
        countsByLvl[lvl].learning += 1;
      }
    }

    const totalKanjiDb = Object.keys(state.kanjiLookup).length || 2230;
    const statJpBox = $('statMasteredTotal') || $('statJpMasteredTotal');
    if (statJpBox) statJpBox.textContent = `${jpMasteredSum} thuộc · ${jpTouched} / ${totalKanjiDb}`;
    const statJpDue = $('statDueToday') || $('statJpDueToday');
    if (statJpDue) statJpDue.textContent = `${getDueKanjiChars().length} chữ cần ôn hôm nay`;

    // English Vocab stats
    const enEntries = Object.entries(state.progress.enVocab || {});
    const enTouched = enEntries.length;
    let enMasteredSum = 0;
    const enRootsTouched = new Set();

    enEntries.forEach(([w, rec]) => {
      const st = computeSrsStatus(rec);
      if (st === 'mastered') enMasteredSum += 1;
      const meta = window.EnAtelierApp?.getWordMeta?.(w);
      if (meta?.rootId) enRootsTouched.add(meta.rootId);
    });

    const enTotal = window.EnAtelierApp?.getTotalCount?.() || 253;
    if ($('statEnMasteredTotal')) {
      $('statEnMasteredTotal').textContent = `${enMasteredSum} thuộc · ${enTouched} / ${enTotal}`;
    }
    if ($('statEnDueToday')) {
      $('statEnDueToday').textContent = `${getDueEnWords().length} từ cần ôn · ${enRootsTouched.size} / 36 họ gốc`;
    }

    // 1. JLPT Progress bars
    const bars = $('jlptProgressBars');
    if (bars) {
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

    // 2. CEFR Progress bars
    const cefrBars = $('cefrProgressBars');
    if (cefrBars) {
      cefrBars.innerHTML = '';
      const cefrList = ['A1', 'A2', 'B1', 'B2', 'C1'];
      const cefrCounts = {
        A1: { mastered: 0, learning: 0, total: 36, topTotal: 998 },
        A2: { mastered: 0, learning: 0, total: 48, topTotal: 1483 },
        B1: { mastered: 0, learning: 0, total: 61, topTotal: 2474 },
        B2: { mastered: 0, learning: 0, total: 58, topTotal: 2497 },
        C1: { mastered: 0, learning: 0, total: 50, topTotal: 2515 },
      };

      for (const [w, rec] of enEntries) {
        const lvl = window.EnAtelierApp?.getWordLevel?.(w) || 'A1';
        const st = computeSrsStatus(rec);
        if (cefrCounts[lvl]) {
          if (st === 'mastered') cefrCounts[lvl].mastered += 1;
          else if (st === 'learning' || st === 'due') cefrCounts[lvl].learning += 1;
        }
      }

      cefrList.forEach((lvl) => {
        const c = cefrCounts[lvl];
        const mPct = ((c.mastered / c.total) * 100).toFixed(1);
        const lPct = ((c.learning / c.total) * 100).toFixed(1);
        const row = document.createElement('div');
        row.className = 'jlpt-bar-row';
        row.innerHTML = `
          <div class="jlpt-bar-head">
            <strong>CEFR ${lvl}</strong>
            <span class="mono">${c.mastered} thuộc sâu · ${c.learning} đang luyện / ${c.total} từ (kho 10k: ${c.topTotal})</span>
          </div>
          <div class="jlpt-bar-track">
            <div class="bar-mastered" style="width:${mPct}%"></div>
            <div class="bar-en-learning" style="width:${lPct}%"></div>
          </div>
        `;
        cefrBars.appendChild(row);
      });

      // 36 Roots row
      const rRow = document.createElement('div');
      rRow.className = 'jlpt-bar-row';
      const rPct = ((enRootsTouched.size / 36) * 100).toFixed(1);
      rRow.innerHTML = `
        <div class="jlpt-bar-head">
          <strong>36 Họ Gốc từ Latin &amp; Hy Lạp</strong>
          <span class="mono">${enRootsTouched.size} / 36 họ gốc đã khám phá (${rPct}%)</span>
        </div>
        <div class="jlpt-bar-track">
          <div class="bar-en-learning" style="width:${rPct}%"></div>
        </div>
      `;
      cefrBars.appendChild(rRow);
    }

    renderNeuroExtendedAnalytics();
  }

  function renderNeuroExtendedAnalytics() {
    // 1. Multi-module summary
    const modBox = $('neuroModuleSummary');
    if (modBox) {
      const kanjiCount = Object.keys(state.progress.kanji || {}).length;
      const totalKanjiDb = Object.keys(state.kanjiLookup).length || 2230;
      const readingsDoneIds = Object.keys(state.progress.readingsDone || {});
      const readingsTotal = (state.readingsLoaded && state.readings.length) || 35;
      const customCount = (state.progress.customReadings || []).length;

      const sDoneEntries = Object.values(state.progress.sentencesDone || {});
      const forgeDone = sDoneEntries.filter((x) => x.forge).length;
      const dictDone = sDoneEntries.filter((x) => x.dictation).length;
      const sentTotal = (state.sentencesLoaded && state.sentences.length) || 45;

      const examNotesMap = state.progress.examNotes || {};
      const examsDoneCount = Object.entries(examNotesMap).filter(([id, x]) => !id.startsWith('chukyu-') && !id.startsWith('mimi-') && x.done).length;
      const chukyuDoneCount = Object.entries(examNotesMap).filter(([id, x]) => /^chukyu-\d+$/.test(id) && x.done).length;
      const mimiDoneCount = Object.entries(examNotesMap).filter(([id, x]) => /^mimi-n3-u\d+$/.test(id) && x.done).length;
      const examNotesCount = Object.values(examNotesMap).filter((x) => (x.note || '').trim()).length;
      const examTotal = (state.examsLoaded && state.examCatalog.length) || 125;

      const enEntries = Object.entries(state.progress.enVocab || {});
      const enTouched = enEntries.length;
      const enMastered = enEntries.filter(([, rec]) => computeSrsStatus(rec) === 'mastered').length;
      const enTotal = window.EnAtelierApp?.getTotalCount?.() || 253;
      const enRootsCount = window.EnAtelierApp?.getRootsCount?.() || 36;
      const enRootsTouched = new Set();
      enEntries.forEach(([w]) => {
        const m = window.EnAtelierApp?.getWordMeta?.(w);
        if (m?.rootId) enRootsTouched.add(m.rootId);
      });

      const enReadingStats = window.EnAtelierApp?.getEnReadingStats?.();
      const enReadingsDoneCount = typeof enReadingStats?.done === 'number'
        ? enReadingStats.done
        : Object.keys(state.progress.enReadingsDone || {}).length;
      const enReadingsTotal = typeof enReadingStats?.total === 'number' && enReadingStats.total > 0
        ? enReadingStats.total
        : 15;
      const enCustomCount = Array.isArray(state.progress.enCustomReadings)
        ? state.progress.enCustomReadings.length
        : 0;

      modBox.innerHTML = `
        <div class="neuro-mod-item">
          <div class="neuro-mod-head"><span>1. Xưởng chữ (Kanji N5–N1)</span><span class="mono">${kanjiCount} / ${totalKanjiDb} chữ đã chạm</span></div>
          <div class="neuro-mod-sub">Gồm các chữ bạn đã vẽ nét, tự nhớ mù hoặc đưa vào hàng đợi SRS hôm nay.</div>
        </div>
        <div class="neuro-mod-item">
          <div class="neuro-mod-head"><span>2. Đọc sâu (JLPT &amp; Giáo trình)</span><span class="mono">${readingsDoneIds.length} / ${readingsTotal} bài${customCount ? ` (+${customCount} bài tự dán)` : ''}</span></div>
          <div class="neuro-mod-sub">25 bài JLPT N5–N1 + 10 bài giáo trình 中級へ行こう kèm audio CD.</div>
        </div>
        <div class="neuro-mod-item">
          <div class="neuro-mod-head"><span>3. Xưởng câu &amp; Nghe chép tĩnh</span><span class="mono">${forgeDone} ghép (★) · ${dictDone} nghe chép / ${sentTotal} câu</span></div>
          <div class="neuro-mod-sub">Lắp ghép 4 mảnh ngữ pháp chuẩn JLPT và nghe chép từng ký tự Kana.</div>
        </div>
        <div class="neuro-mod-item">
          <div class="neuro-mod-head"><span>4. Kho đề thi &amp; Sách giáo trình</span><span class="mono">${examsDoneCount} / ${examTotal} đề · ${chukyuDoneCount} / 10 中級 · ${mimiDoneCount} / 12 Unit 耳から · ${examNotesCount} ghi chú</span></div>
          <div class="neuro-mod-sub">Đề thi thật (2010–2026), giáo trình 中級へ行こう &amp; sách từ vựng 耳から覚える N3.</div>
        </div>
        <div class="neuro-mod-item">
          <div class="neuro-mod-head"><span>5. Tiếng Anh (LEXICON Gốc từ &amp; Kho 10.000 từ)</span><span class="mono">${enTouched} / ${enTotal} cốt lõi · ${enMastered} thuộc sâu · ${enRootsTouched.size}/${enRootsCount} gốc</span></div>
          <div class="neuro-mod-sub">Giải phẫu Tiền tố + Gốc từ Latin/Hy Lạp, YouGlish phụ đề thật, luyện đọc mic và gõ chính tả mù.</div>
        </div>
        <div class="neuro-mod-item">
          <div class="neuro-mod-head"><span>6. Đọc sâu Tiếng Anh (LEXICON A1–C1)</span><span class="mono">${enReadingsDoneCount} / ${enReadingsTotal} bài${enCustomCount ? ` (+${enCustomCount} bài tự dán)` : ''}</span></div>
          <div class="neuro-mod-sub">15 bài đọc sâu phân tầng CEFR A1–C1 chống đọc lướt kèm giải phẫu gốc từ ngay tại đoạn văn.</div>
        </div>
      `;
    }

    renderNeuroForecastChart();
    renderNeuroRoster();

    // Deep Reading Summaries & Exam Notes Archive
    const archiveEl = $('neuroNotesArchive');
    if (archiveEl) {
      const items = [];
      const allReadings = getAllReadings();
      Object.entries(state.progress.readingsDone || {}).forEach(([id, info]) => {
        const found = allReadings.find((r) => r.id === id);
        const title = found ? found.title : `Bài đọc ${id}`;
        const summary = (info.summary || '').trim() || '(Đã hoàn thành bài đọc — chưa nhập tóm tắt)';
        items.push({ kind: 'reading', title, text: summary });
      });

      const enDoneMap = state.progress.enReadingsDone || {};
      const enNotesMap = state.progress.enReadingNotes || {};
      const enCustomList = Array.isArray(state.progress.enCustomReadings) ? state.progress.enCustomReadings : [];
      const enReadingIds = new Set([...Object.keys(enDoneMap), ...Object.keys(enNotesMap)]);
      enReadingIds.forEach((id) => {
        const doneInfo = enDoneMap[id];
        const noteInfo = enNotesMap[id];
        const rawSummary = noteInfo?.summary ?? doneInfo?.summary ?? '';
        const summary = String(rawSummary ?? '').trim();
        if (!doneInfo && !summary) return;
        const resolvedTitle = window.EnAtelierApp?.getReadingTitleById?.(id)
          || enCustomList.find((r) => r.id === id)?.title
          || noteInfo?.title
          || `Bài đọc Tiếng Anh ${id}`;
        items.push({
          kind: 'reading',
          title: `🇬🇧 ${resolvedTitle}`,
          text: summary || '(Đã hoàn thành bài đọc Tiếng Anh — chưa nhập tóm tắt)',
        });
      });

      Object.entries(state.progress.examNotes || {}).forEach(([id, info]) => {
        const note = (info.note || '').trim();
        if (!note && !info.done) return;
        const foundExam = state.examCatalog.find((ex) => ex.id === id);
        const foundChukyu = state.textbookData?.lessons?.find((ls) => ls.id === id);
        const foundMimi = state.mimiBookData?.units?.find((u) => u.id === id);
        let title = foundExam ? foundExam.title : '';
        if (!title && foundChukyu) title = `📘 中級へ行こう · Bài ${foundChukyu.lessonNum}: ${foundChukyu.titleJp}`;
        if (!title && id === 'chukyu-guide') title = '📘 中級へ行こう · 教師用ガイド';
        if (!title && foundMimi) title = `🎧 耳から N3 — Unit ${String(foundMimi.unitNum).padStart(2, '0')}: ${foundMimi.titleJp} (${foundMimi.titleVi})`;
        if (!title && id === 'mimi-n3-ref') title = '🎧 耳から N3 — 語彙索引 (Tra cứu 50 âm)';
        if (!title) title = `Đề / Tài liệu ${id}`;
        items.push({
          kind: 'exam',
          title: `${title}${info.done ? ' (Đã hoàn thành)' : ''}`,
          text: note || '(Đã đánh dấu hoàn thành)',
        });
      });

      archiveEl.innerHTML = '';
      if (!items.length) {
        archiveEl.innerHTML = '<div class="rk-empty">Chưa có tóm tắt bài đọc hoặc ghi chú phòng thi nào. Các ghi chú bạn viết ở tab <strong>Đọc sâu</strong> và <strong>Kho đề thi</strong> sẽ tập hợp tại đây.</div>';
      } else {
        items.forEach((it) => {
          const div = document.createElement('div');
          div.className = `neuro-note-entry${it.kind === 'exam' ? ' exam' : ''}`;
          const tEl = document.createElement('div');
          tEl.className = 'neuro-note-title';
          tEl.textContent = it.title;
          const bEl = document.createElement('div');
          bEl.textContent = it.text;
          div.appendChild(tEl);
          div.appendChild(bEl);
          archiveEl.appendChild(div);
        });
      }
    }
  }

  function renderNeuroForecastChart() {
    const forecastEl = $('srsForecastChart');
    if (!forecastEl) return;
    const mode = state.forecastMode || 'all';

    qsa('.forecast-tab').forEach((b) => b.classList.toggle('active', b.dataset.fc === mode));

    let pool = [];
    if (mode === 'all') {
      pool = [...Object.values(state.progress.kanji || {}), ...Object.values(state.progress.enVocab || {})];
    } else if (mode === 'jp') {
      pool = Object.values(state.progress.kanji || {});
    } else if (mode === 'en') {
      pool = Object.values(state.progress.enVocab || {});
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;
    const buckets = [0, 0, 0, 0, 0, 0, 0];

    pool.forEach((rec) => {
      if (!rec || !rec.due) return;
      const dueMs = new Date(rec.due).getTime();
      if (dueMs <= Date.now()) {
        buckets[0] += 1;
        return;
      }
      const diffDays = Math.floor((dueMs - startOfToday.getTime()) / dayMs);
      if (diffDays >= 0 && diffDays < 7) buckets[diffDays] += 1;
    });

    const maxVal = Math.max(1, ...buckets);
    const labels = ['Hôm nay', 'Ngày mai', '+2 ngày', '+3 ngày', '+4 ngày', '+5 ngày', '+6 ngày'];
    forecastEl.innerHTML = '';
    buckets.forEach((cnt, idx) => {
      const pct = cnt > 0 ? Math.max(14, Math.round((cnt / maxVal) * 100)) : 4;
      const col = document.createElement('div');
      col.className = `srs-f-col${idx === 0 ? ' today' : ''}`;
      col.innerHTML = `
        <span class="srs-f-count">${cnt}</span>
        <div class="srs-f-bar-wrap"><div class="srs-f-bar" style="height:${pct}%"></div></div>
        <span class="srs-f-label">${labels[idx]}</span>
      `;
      forecastEl.appendChild(col);
    });
  }

  function renderNeuroRoster() {
    const rosterEl = $('learnedKanjiRoster') || $('learnedRosterBox');
    if (!rosterEl) return;
    const mode = state.rosterMode || 'jp';

    const jpCount = Object.keys(state.progress.kanji || {}).length;
    const enCount = Object.keys(state.progress.enVocab || {}).length;
    if ($('learnedKanjiCount')) $('learnedKanjiCount').textContent = String(jpCount);
    if ($('learnedEnCount')) $('learnedEnCount').textContent = String(enCount);

    qsa('.roster-tab').forEach((b) => b.classList.toggle('active', b.dataset.rtab === mode));

    rosterEl.innerHTML = '';

    if (mode === 'jp') {
      const learnedEntries = Object.entries(state.progress.kanji || {})
        .filter(([ch]) => Boolean(state.kanjiLookup[ch]))
        .sort((a, b) => {
          const sa = getKanjiStatus(a[0]) === 'due' ? 0 : 1;
          const sb = getKanjiStatus(b[0]) === 'due' ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return (a[1].interval || 0) - (b[1].interval || 0);
        });

      if (!learnedEntries.length) {
        rosterEl.innerHTML = '<div class="rk-empty">Chưa có chữ nào được lưu. Hãy luyện viết trong Xưởng chữ để bắt đầu xây dựng sổ tay Kanji.</div>';
        return;
      }

      learnedEntries.forEach(([ch, rec]) => {
        const meta = state.kanjiLookup[ch];
        const st = getKanjiStatus(ch);
        const stLabel = st === 'due' ? 'Cần ôn ngay' : st === 'mastered' ? `Thuộc (${rec.interval}d)` : `${rec.writePasses || 0} lần viết`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'learned-kanji-tile';
        btn.title = rec.note ? `Ghi chú: ${rec.note}` : 'Bấm để mở lại trong Xưởng chữ';
        btn.innerHTML = `
          <span class="learned-kanji-glyph">${escHtml(ch)}</span>
          <span class="learned-kanji-meta">
            <div class="learned-kanji-hv">${escHtml(meta.hv)} <span class="related-chip-lvl">N${escHtml(meta.l)}</span></div>
            <div class="learned-kanji-sub">${escHtml(stLabel)}${rec.note ? ' · Có ghi chú' : ''}</div>
          </span>
        `;
        btn.addEventListener('click', () => jumpToKanji(ch));
        rosterEl.appendChild(btn);
      });
    } else {
      const learnedWords = Object.entries(state.progress.enVocab || {})
        .sort((a, b) => {
          const sa = computeSrsStatus(a[1]) === 'due' ? 0 : 1;
          const sb = computeSrsStatus(b[1]) === 'due' ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return (a[1].interval || 0) - (b[1].interval || 0);
        });

      if (!learnedWords.length) {
        rosterEl.innerHTML = '<div class="rk-empty">Chưa có từ vựng Tiếng Anh nào được lưu. Hãy học trong Xưởng Gốc Từ để bắt đầu xây dựng sổ tay từ vựng.</div>';
        return;
      }

      learnedWords.forEach(([word, rec]) => {
        const meta = window.EnAtelierApp?.getWordMeta?.(word) || { w: word, lvl: 'A1', vi: '', rootId: '' };
        const st = computeSrsStatus(rec);
        const stLabel = st === 'due' ? 'Cần ôn ngay' : st === 'mastered' ? `Thuộc (${rec.interval}d)` : `Luyện (${rec.interval || 1}d)`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'learned-en-tile';
        btn.title = `Bấm để mở từ "${word}" trong Xưởng Gốc Từ`;
        btn.innerHTML = `
          <span class="learned-en-badge">${escHtml(meta.lvl || 'A1')}</span>
          <span class="learned-en-meta">
            <div class="learned-en-word">${escHtml(word)}</div>
            <div class="learned-en-sub">${meta.rootId ? `gốc ${escHtml(meta.rootId)} · ` : ''}${escHtml(meta.vi || '')} · ${escHtml(stLabel)}</div>
          </span>
        `;
        btn.addEventListener('click', () => {
          if (window.EnAtelierApp?.jumpToWord) {
            window.EnAtelierApp.jumpToWord(word);
          }
        });
        rosterEl.appendChild(btn);
      });
    }
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
      const jpCount = Object.keys(state.progress.kanji || {}).length;
      const enCount = Object.keys(state.progress.enVocab || {}).length;
      box.textContent = [
        `Nhánh hiện tại: ${st.branch || '(detached)'}`,
        `Remote origin: ${st.hasRemote ? st.remoteUrl : 'Chưa gắn remote GitHub'}`,
        `Commit gần nhất: ${st.lastCommit}`,
        `File tiến độ (data/user-progress.json): ${st.progressDirty ? 'Có thay đổi mới chưa commit' : 'Đã đồng bộ với commit mới nhất'}`,
        `Tiến độ hiện lưu: 🇯🇵 ${jpCount} chữ Hán Kanji · 🇬🇧 ${enCount} từ vựng Tiếng Anh`,
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
    const btn = $('themeToggleBtn');
    if (btn) {
      btn.textContent = theme === 'yoru' ? '☀️' : '🌙';
      btn.title = theme === 'yoru' ? 'Chuyển sang nền Giấy sáng (Hanshi)' : 'Chuyển sang nền Mực đêm (Yoru)';
    }
    state.progress.settings.theme = theme;
    if (state.currentMode === 'anatomy' && state.currentKanji) {
      renderAnatomySvg(-1);
    }
  }

  function applySoundSetting(enabled) {
    state.progress.settings.soundEnabled = enabled;
    const btn = $('soundToggleBtn');
    if (btn) {
      btn.textContent = enabled ? '🔔' : '🔕';
      btn.title = enabled ? 'Âm gõ mộc: Đang Bật (Bấm để tắt)' : 'Âm gõ mộc: Đang Tắt (Bấm để bật)';
      btn.setAttribute('aria-pressed', String(enabled));
    }
  }

  function bindAudioPlayerControls({ audioEl, otherAudioEl, otherPlayBtn, playBtn, backBtn, fwdBtn, seekEl, timeEl }) {
    playBtn.addEventListener('click', () => {
      if (!audioEl.src) return;
      if (audioEl.paused) {
        if (otherAudioEl && !otherAudioEl.paused) {
          otherAudioEl.pause();
          if (otherPlayBtn) otherPlayBtn.textContent = 'Nghe tiếp';
        }
        audioEl.play().catch(() => {});
        playBtn.textContent = 'Tạm dừng';
      } else {
        audioEl.pause();
        playBtn.textContent = 'Nghe tiếp';
      }
    });
    backBtn.addEventListener('click', () => {
      if (audioEl.src) audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
    });
    fwdBtn.addEventListener('click', () => {
      if (audioEl.src && audioEl.duration) audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 5);
    });
    seekEl.addEventListener('input', (e) => {
      if (audioEl.duration) {
        audioEl.currentTime = (Number(e.target.value) / 100) * audioEl.duration;
      }
    });
    audioEl.addEventListener('timeupdate', () => {
      const dur = audioEl.duration || 0;
      const cur = audioEl.currentTime || 0;
      timeEl.textContent = `${formatMMSS(Math.floor(cur))} / ${formatMMSS(Math.floor(dur))}`;
      if (dur > 0) seekEl.value = String((cur / dur) * 100);
    });
    audioEl.addEventListener('ended', () => {
      playBtn.textContent = 'Nghe lại';
    });
  }

  function bindDualTrackControls({ slowBtn, natBtn, audioEl, otherAudioEl, otherPlayBtn, playBtn, seekEl, timeEl, getTrackUrls, getPlaybackRate }) {
    [
      { btn: slowBtn, track: 'slow' },
      { btn: natBtn, track: 'nat' },
    ].forEach(({ btn, track }) => {
      btn.addEventListener('click', () => {
        const urls = getTrackUrls();
        const url = urls && urls[track];
        if (!url) return;
        if (otherAudioEl && !otherAudioEl.paused) {
          otherAudioEl.pause();
          if (otherPlayBtn) otherPlayBtn.textContent = 'Nghe tiếp';
        }
        configureDualTrackButtons(slowBtn, natBtn, track);
        setAudioTrackSource(audioEl, url, playBtn, seekEl, timeEl, true);
        if (getPlaybackRate) audioEl.playbackRate = getPlaybackRate();
      });
    });
  }

  // --- Event Binding ---
  function bindEvents() {
    qsa('.space-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchAppSpace(btn.dataset.space));
    });

    if ($('homeStatTotalFocus')) {
      $('homeStatTotalFocus').addEventListener('click', () => {
        switchAppSpace('jp', 'neuro');
      });
    }

    if ($('homeEnterJpBtn')) {
      $('homeEnterJpBtn').addEventListener('click', () => switchAppSpace('jp', 'atelier'));
    }
    if ($('homeEnterEnBtn')) {
      $('homeEnterEnBtn').addEventListener('click', () => switchAppSpace('en', 'enAtelier'));
    }
    if ($('homeEnterSquadronBtn')) {
      $('homeEnterSquadronBtn').addEventListener('click', () => switchAppSpace('en', 'enSquadron'));
    }
    if ($('homeEnterEnReaderBtn')) {
      $('homeEnterEnReaderBtn').addEventListener('click', () => switchAppSpace('en', 'enReader'));
    }
    qsa('[data-quick-jp]').forEach((btn) => {
      btn.addEventListener('click', () => switchAppSpace('jp', btn.dataset.quickJp));
    });

    qsa('#jpLevelTabs .level-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectLevel(Number(btn.dataset.level), true));
    });

    qsa('#jpViewTabs .view-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    qsa('#viewAtelier .mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    qsa('.filter-chip[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filterStatus = btn.dataset.filter;
        qsa('.filter-chip[data-filter]').forEach((c) => c.classList.toggle('active', c === btn));
        applyFilterAndRender();
        if (state.filteredList.length) selectKanji(state.filteredList[0]);
      });
    });

    $('jpDailyLimitSelect')?.addEventListener('change', (e) => {
      state.progress.settings.jpDailyNewLimit = Number(e.target.value) || 10;
      scheduleSaveProgress(true);
      updateDueBadge();
      applyFilterAndRender();
      if (state.filteredList.length) selectKanji(state.filteredList[0]);
    });

    $('jpAddMoreNewBtn')?.addEventListener('click', () => {
      const cur = state.progress.settings.jpDailyNewLimit || 10;
      state.progress.settings.jpDailyNewLimit = cur + 5;
      if ($('jpDailyLimitSelect')) $('jpDailyLimitSelect').value = String(state.progress.settings.jpDailyNewLimit);
      scheduleSaveProgress(true);
      updateDueBadge();
      applyFilterAndRender();
      if (state.filteredList.length) selectKanji(state.filteredList[0]);
    });

    $('jpFilterDrawerToggle')?.addEventListener('click', () => {
      const drawer = $('jpAdvancedFilterDrawer');
      const btn = $('jpFilterDrawerToggle');
      if (!drawer || !btn) return;
      const isHidden = drawer.classList.toggle('hidden');
      btn.classList.toggle('active', !isHidden);
    });

    $('searchInput').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      applyFilterAndRender();
    });

    $('globalSearchToggle').addEventListener('change', (e) => {
      state.globalSearch = e.target.checked;
      applyFilterAndRender();
    });

    $('atelierTextbookSelect').addEventListener('change', (e) => {
      applyTextbookFilter(e.target.value, true);
    });

    $('prevKanjiBtn').addEventListener('click', () => navigateKanji(-1));
    $('nextKanjiBtn').addEventListener('click', () => navigateKanji(1));
    $('speakKanjiBtn').addEventListener('click', () => speakJapanese(state.currentKanji));
    if ($('jpYouglishBtn')) {
      $('jpYouglishBtn').addEventListener('click', () => {
        if (!state.currentKanji) return;
        window.MediaCoach?.openYouGlish(state.currentKanji.c, 'japanese', '', 'jpMediaCoachMount');
      });
    }
    if ($('jpMicCheckBtn')) {
      $('jpMicCheckBtn').addEventListener('click', () => {
        if (!state.currentKanji) return;
        const sampleRead = (state.currentKanji.kun[0] || state.currentKanji.on[0] || '').replace(/[-.]/g, '');
        window.MediaCoach?.openMicCoach({
          word: state.currentKanji.c,
          reading: sampleRead,
          lang: 'ja-JP',
          mountId: 'jpMediaCoachMount',
        });
      });
    }

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

    function handleKanjiSrsGrade(quality) {
      if (!state.currentKanji) return;
      const ch = state.currentKanji.c;
      const prev = state.progress.kanji[ch];
      const wasNew = !prev || (!prev.reps && !prev.writePasses && !prev.blindPasses);

      recordSrsGrade(ch, quality);

      if (state.filterStatus === 'today') {
        const s = state.progress.settings;
        if (quality === 1) {
          state.sessionFailedSet.add(ch);
        } else {
          state.sessionFailedSet.delete(ch);
          if (wasNew && s) {
            s.jpDailyNewCount = (s.jpDailyNewCount || 0) + 1;
          }
        }
        scheduleSaveProgress(true);
        updateDueBadge();

        const currIdx = state.filteredList.findIndex((it) => it.c === ch);
        applyFilterAndRender();

        if (state.filteredList.length) {
          const nextIdx = Math.max(0, Math.min(currIdx === -1 ? 0 : currIdx, state.filteredList.length - 1));
          selectKanji(state.filteredList[nextIdx]);
          if (state.currentMode !== 'anatomy') setMode('anatomy');
        } else {
          state.currentKanji = null;
        }
        return;
      }

      if (state.filterStatus !== 'all') {
        const currIdx = state.filteredList.findIndex((it) => it.c === ch);
        applyFilterAndRender();
        if (state.filteredList.length) {
          const nextIdx = Math.max(0, Math.min(currIdx === -1 ? 0 : currIdx, state.filteredList.length - 1));
          selectKanji(state.filteredList[nextIdx]);
          if (state.currentMode !== 'anatomy') setMode('anatomy');
        } else {
          state.currentKanji = null;
        }
        return;
      }

      renderKanjiList('dots');
      navigateKanji(1);
      if (state.currentMode !== 'anatomy') setMode('anatomy');
    }

    $('jpToggleSidebarBtn')?.addEventListener('click', () => {
      const ws = $('viewAtelier');
      const btn = $('jpToggleSidebarBtn');
      if (!ws || !btn) return;
      const collapsed = ws.classList.toggle('sidebar-collapsed');
      btn.textContent = collapsed ? '▶ Danh sách' : '◀ Danh sách';
    });

    $('jpNextStepBtn')?.addEventListener('click', () => {
      const next = $('jpNextStepBtn')?.dataset.nextmode;
      if (next) setMode(next);
    });

    // SRS Grade buttons (Atelier)
    qsa('#viewAtelier .srs-btn[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        handleKanjiSrsGrade(Number(btn.dataset.quality));
      });
    });

    // Dojo
    qsa('.dojo-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.dojoMode = btn.dataset.dmode;
        qsa('.dojo-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
        if (state.dojoCurrent && !$('dojoCard').classList.contains('hidden')) {
          showDojoCard();
        }
      });
    });
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
    $('dojoInputRead').addEventListener('input', (e) => {
      const val = e.target.value;
      $('dojoKanaPreview').textContent = /^[a-zA-Z\s'-]+$/.test(val) ? romajiToHiragana(val) : val;
    });
    $('dojoTypingForm').addEventListener('submit', checkDojoTyping);
    $('dojoTypingRevealBtn').addEventListener('click', () => {
      if (!state.dojoCurrent) return;
      const e = state.dojoCurrent;
      revealDojoTypingInfo(e);
      const resEl = $('dojoTypingResult');
      resEl.classList.remove('hidden', 'ok', 'warn');
      resEl.textContent = `Đáp án: ${e.c} (${e.hv}) | On: ${e.on.join(', ') || '—'} | Kun: ${e.kun.join(', ') || '—'}`;
    });
    qsa('[data-dojo-q]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!state.dojoCurrent) return;
        const quality = Number(btn.dataset.dojoQ);
        state.dojoResults.push({
          c: state.dojoCurrent.c,
          hv: state.dojoCurrent.hv,
          l: state.dojoCurrent.l,
          quality,
        });
        recordSrsGrade(state.dojoCurrent.c, quality);
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
        const base = createDefaultProgress();
        state.progress = {
          ...base,
          ...parsed,
          settings: { ...base.settings, ...(parsed.settings || {}) },
          stats: { ...base.stats, ...(parsed.stats || {}) },
          kanji: parsed.kanji || {},
          enVocab: parsed.enVocab || {},
          readingsDone: parsed.readingsDone || {},
          customReadings: Array.isArray(parsed.customReadings) ? parsed.customReadings : [],
          enReadingsDone: (parsed.enReadingsDone && typeof parsed.enReadingsDone === 'object' && !Array.isArray(parsed.enReadingsDone)) ? parsed.enReadingsDone : {},
          enReadingNotes: (parsed.enReadingNotes && typeof parsed.enReadingNotes === 'object' && !Array.isArray(parsed.enReadingNotes)) ? parsed.enReadingNotes : {},
          enCustomReadings: Array.isArray(parsed.enCustomReadings) ? parsed.enCustomReadings : [],
          sentencesDone: parsed.sentencesDone || {},
          examNotes: parsed.examNotes || {},
          sessionLogs: Array.isArray(parsed.sessionLogs) ? parsed.sessionLogs : [],
        };
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

    qsa('.forecast-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.forecastMode = btn.dataset.fc;
        renderNeuroForecastChart();
      });
    });

    qsa('.roster-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.rosterMode = btn.dataset.rtab;
        renderNeuroRoster();
      });
    });

    // Module 3: Deep Reader events
    qsa('.reader-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.readerFilter = btn.dataset.rfilter;
        qsa('.reader-filter').forEach((c) => c.classList.toggle('active', c === btn));
        renderReaderList(true);
      });
    });

    $('openCustomReadingBtn').addEventListener('click', () => {
      $('customReadingForm').classList.toggle('hidden');
    });
    $('cancelCustomReadingBtn').addEventListener('click', () => {
      $('customReadingForm').classList.add('hidden');
    });
    $('customReadingForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = $('customReadingTitle').value.trim();
      const lvl = Number($('customReadingLevel').value) || 5;
      const body = $('customReadingBody').value.trim();
      if (!title || !body) return;
      const rawBlocks = body.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
      const blocks = rawBlocks.length > 1 ? rawBlocks : body.split(/\n+/).map((s) => s.trim()).filter(Boolean);

      const submitBtn = $('customReadingForm').querySelector('button[type="submit"]');
      const origLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Đang dịch & phân tích Kanji...';

      let paragraphs = blocks.map((jp) => ({ jp, vi: '', vocab: [], words: [] }));
      try {
        if (state.hasServerApi) {
          const res = await fetch('/api/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paragraphs: blocks }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.ok && Array.isArray(data.results) && data.results.length) {
              paragraphs = data.results.map((item) => ({
                jp: item.jp,
                vi: item.vi || '',
                vocab: [],
                words: Array.isArray(item.words) ? item.words : [],
              }));
            }
          }
        }
      } catch (_) {
        // Offline / lookup failed: save raw Japanese text so user is never blocked
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = origLabel;
      }

      const custom = {
        id: `custom-${Date.now()}`,
        level: lvl,
        title,
        source: 'Bài đọc tự nhập (Cá nhân)',
        category: 'Tự nhập',
        paragraphs,
        questions: [],
      };
      state.progress.customReadings = state.progress.customReadings || [];
      state.progress.customReadings.unshift(custom);
      scheduleSaveProgress(true);
      $('customReadingTitle').value = '';
      $('customReadingBody').value = '';
      $('customReadingForm').classList.add('hidden');
      if (state.readerFilter === 'chukyu') {
        state.readerFilter = 'all';
        qsa('.reader-filter').forEach((c) => c.classList.toggle('active', c.dataset.rfilter === 'all'));
      }
      selectLevel(lvl, false).then(() => {
        renderReaderList(false);
        selectReading(custom);
      });
    });

    $('rwSpeakBtn').addEventListener('click', () => {
      if (state.readerSelectedWord) speakJapaneseText(state.readerSelectedWord, 0.9);
    });

    $('readerQuickLookupInput').addEventListener('input', (e) => {
      clearTimeout(state.readerLookupTimer);
      const val = e.target.value;
      state.readerLookupTimer = setTimeout(() => {
        lookupAndInspectReaderText(val);
      }, 350);
    });

    $('readerQuickLookupInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(state.readerLookupTimer);
        lookupAndInspectReaderText(e.target.value);
      }
    });

    $('readerParagraphs').addEventListener('mouseup', () => {
      const selObj = window.getSelection ? window.getSelection() : null;
      if (!selObj || selObj.isCollapsed) return;
      const raw = (selObj.toString() || '').trim().replace(/\s+/g, '');
      if (raw && raw.length <= 120 && /[\u3040-\u30ff\u4e00-\u9faf]/.test(raw)) {
        $('readerQuickLookupInput').value = raw;
        lookupAndInspectReaderText(raw);
      }
    });

    $('readerSpeakBtn').addEventListener('click', () => {
      if (!state.currentReading) return;
      const fullText = state.currentReading.paragraphs
        .slice(0, state.readerAllUnlocked ? undefined : state.readerUnlockedIdx + 1)
        .map((p) => p.jp)
        .join('。');
      speakJapaneseText(fullText, 0.86);
    });

    const readerAudioEl = $('readerAudioEl');
    const examAudioEl = $('examAudioEl');
    bindDualTrackControls({
      slowBtn: $('readerTrackSlowBtn'),
      natBtn: $('readerTrackNatBtn'),
      audioEl: readerAudioEl,
      otherAudioEl: examAudioEl,
      otherPlayBtn: $('examPlayPauseBtn'),
      playBtn: $('readerAudioPlayBtn'),
      seekEl: $('readerAudioSeek'),
      timeEl: $('readerAudioTime'),
      getTrackUrls: () => (state.currentReading ? { slow: state.currentReading.audioSlow, nat: state.currentReading.audioNatural } : null),
    });
    bindAudioPlayerControls({
      audioEl: readerAudioEl,
      otherAudioEl: examAudioEl,
      otherPlayBtn: $('examPlayPauseBtn'),
      playBtn: $('readerAudioPlayBtn'),
      backBtn: $('readerBack5Btn'),
      fwdBtn: $('readerFwd5Btn'),
      seekEl: $('readerAudioSeek'),
      timeEl: $('readerAudioTime'),
    });

    $('readerResetBtn').addEventListener('click', () => {
      if (!state.currentReading) return;
      selectReading(state.currentReading);
    });

    $('readerCompleteBtn').addEventListener('click', () => {
      if (!state.currentReading) return;
      state.progress.readingsDone = state.progress.readingsDone || {};
      state.progress.readingsDone[state.currentReading.id] = {
        completedAt: new Date().toISOString(),
        summary: $('readerSummaryInput').value.trim(),
      };
      scheduleSaveProgress(true);
      $('readerDoneBadge').textContent = 'Đã hoàn thành & lưu ổ đĩa';
      renderReaderList(false);
    });

    $('rkOpenAtelierBtn').addEventListener('click', () => {
      if (state.readerSelectedKanji) jumpToKanji(state.readerSelectedKanji);
    });
    $('rkAddSrsBtn').addEventListener('click', () => {
      if (!state.readerSelectedKanji) return;
      enqueueKanjiForSrs(state.readerSelectedKanji);
      $('rkAddSrsBtn').textContent = 'Đã đưa vào SRS!';
      setTimeout(() => { $('rkAddSrsBtn').textContent = 'Đưa vào ôn SRS'; }, 1400);
    });

    // Exam Studio & Textbook events
    qsa('.exam-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchExamMode(btn.dataset.emode));
    });

    qsa('.tb-book-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTextbookBook(btn.dataset.tbbook, true));
    });

    qsa('.mimi-step-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mimiStepFilter = btn.dataset.step;
        qsa('.mimi-step-filter').forEach((c) => c.classList.toggle('active', c === btn));
        renderMimiUnitList(true);
      });
    });

    $('tbPageJumpForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const book = state.mimiBookData;
      if (!book) return;
      const rawNum = parseInt($('tbPageJumpInput')?.value || '', 10);
      if (Number.isNaN(rawNum)) return;
      const maxBook = (book.totalPages || 236) - (book.pageOffset ?? 1);
      const bookPage = Math.max(0, Math.min(maxBook, rawNum));
      const pdfPage = Math.max(1, Math.min(book.totalPages || 236, bookPage + (book.pageOffset ?? 1)));
      if ($('tbPageJumpInput')) $('tbPageJumpInput').value = String(bookPage);
      const isGuard = pdfPage >= (book.refPages?.answersCover || 225);
      $('tbSectionBar')?.querySelectorAll('.tb-sec-btn').forEach((x) => x.classList.remove('active'));
      $('tbMimiColumnsList')?.querySelectorAll('.tb-mimi-col-btn').forEach((x) => x.classList.remove('active'));
      openPdfAtPage(book.pdfUrl, pdfPage, isGuard);
    });

    qsa('.exam-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.examFilter = btn.dataset.efilter;
        qsa('.exam-filter').forEach((c) => c.classList.toggle('active', c === btn));
        renderExamList(true);
      });
    });

    $('examSearchInput').addEventListener('input', (e) => {
      state.examSearch = e.target.value;
      if (state.examMode === 'textbook') {
        if (state.activeTextbookId === 'mimi-n3') renderMimiUnitList(true);
        else renderTextbookList(true);
      } else {
        renderExamList(true);
      }
    });

    bindDualTrackControls({
      slowBtn: $('tbTrackSlowBtn'),
      natBtn: $('tbTrackNatBtn'),
      audioEl: examAudioEl,
      otherAudioEl: readerAudioEl,
      otherPlayBtn: $('readerAudioPlayBtn'),
      playBtn: $('examPlayPauseBtn'),
      seekEl: $('examAudioSeek'),
      timeEl: $('examAudioTime'),
      getTrackUrls: () => (state.currentTextbookLesson ? { slow: state.currentTextbookLesson.audioSlow, nat: state.currentTextbookLesson.audioNatural } : null),
      getPlaybackRate: () => Number($('examSpeedSelect').value) || 1,
    });
    bindAudioPlayerControls({
      audioEl: examAudioEl,
      otherAudioEl: readerAudioEl,
      otherPlayBtn: $('readerAudioPlayBtn'),
      playBtn: $('examPlayPauseBtn'),
      backBtn: $('examBack5Btn'),
      fwdBtn: $('examFwd5Btn'),
      seekEl: $('examAudioSeek'),
      timeEl: $('examAudioTime'),
    });
    $('examSpeedSelect').addEventListener('change', (e) => {
      examAudioEl.playbackRate = Number(e.target.value) || 1;
    });

    $('tbOpenAtelierBtn').addEventListener('click', async () => {
      if (!state.currentTextbookLesson) return;
      const key = String(state.currentTextbookLesson.lessonNum);
      $('atelierTextbookSelect').value = key;
      await applyTextbookFilter(key, true);
      switchView('atelier');
    });

    $('examQuickKanjiInput').addEventListener('input', (e) => {
      renderExamQuickKanji(e.target.value);
    });

    $('examNoteInput').addEventListener('input', (e) => {
      const id = getActiveExamDocId();
      if (!id) return;
      state.progress.examNotes = state.progress.examNotes || {};
      const prev = state.progress.examNotes[id] || { done: false, note: '' };
      prev.note = e.target.value;
      state.progress.examNotes[id] = prev;
      $('examNoteSaveHint').textContent = 'Đang lưu...';
      clearTimeout(state.examNoteTimer);
      state.examNoteTimer = setTimeout(() => {
        scheduleSaveProgress(true);
        $('examNoteSaveHint').textContent = 'Đã lưu ổ đĩa';
      }, 450);
    });

    $('examToggleDoneBtn').addEventListener('click', () => {
      const id = getActiveExamDocId();
      if (!id) return;
      state.progress.examNotes = state.progress.examNotes || {};
      const prev = state.progress.examNotes[id] || { done: false, note: '' };
      prev.done = !prev.done;
      prev.updatedAt = new Date().toISOString();
      state.progress.examNotes[id] = prev;
      scheduleSaveProgress(true);
      if (state.examMode === 'textbook') {
        if (state.activeTextbookId === 'mimi-n3') {
          const isRef = id === 'mimi-n3-ref';
          $('examToggleDoneBtn').textContent = prev.done
            ? (isRef ? 'Đã rà soát (Bấm để bỏ đánh dấu)' : 'Đã học xong Unit này (Bấm để bỏ đánh dấu)')
            : (isRef ? 'Đánh dấu đã rà soát bảng tra cứu' : 'Đánh dấu đã học xong Unit này');
          renderMimiUnitList(false);
          const allUnits = state.mimiBookData?.units || [];
          const doneCount = allUnits.filter((u) => isExamDone(u.id)).length;
          if ($('tbMimiUnitProgress')) $('tbMimiUnitProgress').textContent = `${doneCount} / ${allUnits.length} Unit`;
        } else {
          const isGuide = id === 'chukyu-guide';
          $('examToggleDoneBtn').textContent = prev.done
            ? (isGuide ? 'Đã xem xong' : 'Đã học xong (Bấm để bỏ đánh dấu)')
            : (isGuide ? 'Đánh dấu đã xem xong hướng dẫn' : 'Đánh dấu đã học xong bài này');
          renderTextbookList(false);
        }
      } else {
        $('examToggleDoneBtn').textContent = prev.done ? 'Đã giải xong (Bấm để bỏ đánh dấu)' : 'Đánh dấu đã giải xong đề này';
        renderExamList(false);
      }
    });

    // Module 4: Sentence Forge & Blind Dictation events
    qsa('.forge-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.forgeMode = btn.dataset.fmode;
        qsa('.forge-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
        if (state.currentSentence) selectSentence(state.currentSentence);
      });
    });

    qsa('.forge-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.forgeFilter = btn.dataset.ffilter;
        qsa('.forge-filter').forEach((b) => b.classList.toggle('active', b === btn));
        renderForgeList(true);
      });
    });

    $('forgePrevBtn').addEventListener('click', () => navigateSentence(-1));
    $('forgeNextBtn').addEventListener('click', () => navigateSentence(1));

    $('forgeHintBtn').addEventListener('click', () => {
      if (!state.currentSentence) return;
      $('forgeHintText').textContent = `Nghĩa: ${state.currentSentence.vi}`;
      $('forgeHintText').classList.remove('hidden');
    });
    $('forgeCheckBtn').addEventListener('click', checkSentenceForge);
    $('forgeResetBtn').addEventListener('click', () => {
      if (!state.currentSentence) return;
      state.forgeSlots = [null, null, null, null];
      $('forgeResultBox').classList.add('hidden');
      renderForgeBuilder(false);
    });
    $('forgeSpeakBtn').addEventListener('click', () => {
      if (state.currentSentence) speakJapaneseText(state.currentSentence.fullJp, 0.88);
    });

    $('dictSpeakNormalBtn').addEventListener('click', () => {
      if (state.currentSentence) speakJapaneseText(state.currentSentence.fullJp, 1.0);
    });
    $('dictSpeakSlowBtn').addEventListener('click', () => {
      if (state.currentSentence) speakJapaneseText(state.currentSentence.fullJp, 0.72);
    });
    $('dictHintBtn').addEventListener('click', () => {
      if (!state.currentSentence) return;
      $('dictHintText').textContent = `Nghĩa: ${state.currentSentence.vi} (${state.currentSentence.kana.length} ký tự Kana)`;
      $('dictHintText').classList.remove('hidden');
    });
    $('dictInput').addEventListener('input', (e) => {
      const converted = convertDictationInput(e.target.value);
      $('dictKanaPreview').textContent = converted ? `Kana: ${converted}` : '';
    });
    $('dictCheckBtn').addEventListener('click', checkBlindDictation);
    $('dictClearBtn').addEventListener('click', () => {
      $('dictInput').value = '';
      $('dictKanaPreview').textContent = '';
      $('dictResultBox').classList.add('hidden');
    });
    $('fkOpenAtelierBtn').addEventListener('click', () => {
      if (state.forgeSelectedKanji) jumpToKanji(state.forgeSelectedKanji);
    });
    $('fkAddSrsBtn').addEventListener('click', () => {
      if (!state.forgeSelectedKanji) return;
      enqueueKanjiForSrs(state.forgeSelectedKanji);
      $('fkAddSrsBtn').textContent = 'Đã đưa vào SRS!';
      setTimeout(() => { $('fkAddSrsBtn').textContent = 'Đưa vào ôn SRS'; }, 1400);
    });

    // Keyboard shortcuts [, ], and 1-4 SRS grading when not typing
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (state.currentSpace !== 'jp' || state.currentView !== 'atelier') return;
      if (e.key === '[') navigateKanji(-1);
      if (e.key === ']') navigateKanji(1);
      if (['1', '2', '3', '4'].includes(e.key)) {
        handleKanjiSrsGrade(Number(e.key));
      }
    });
  }

  function navigateKanji(delta) {
    const list = state.filteredList.filter((x) => !x._isLookup);
    if (!list.length || !state.currentKanji) return;
    const idx = list.findIndex((x) => x.c === state.currentKanji.c);
    const nextIdx = Math.max(0, Math.min(list.length - 1, (idx === -1 ? 0 : idx) + delta));
    selectKanji(list[nextIdx]);
  }

  window.BokusekiApp = {
    getState: () => state,
    getProgress: () => state.progress,
    saveProgress: (immediate = true) => scheduleSaveProgress(immediate),
    updateDueBadges: () => updateDueBadge(),
    getLocalDateKey,
    getDueKanjiChars,
    getDueEnWords,
    playWoodTap,
    stripVietnamese,
    computeSrsStatus,
    previewSrsRecord,
    applySrsGradeToRecord,
    buildCharDiffHtml,
    switchAppSpace,
    switchView,
    renderHomeHub,
    renderNeuroDashboard,
  };

  // --- Bootstrap ---
  async function init() {
    bindEvents();
    await Promise.all([loadProgress(), ensureMetaIndexes(), ensureTextbookLoaded()]);
    applyTheme(state.progress.settings.theme || 'hanshi');
    applySoundSetting(Boolean(state.progress.settings.soundEnabled));
    const defMin = state.progress.settings.focusDurationMin || 15;
    $('focusDurationSelect').value = String(defMin);
    $('focusTimerText').textContent = `Tập trung ${defMin}:00`;
    updateDueBadge();
    await selectLevel(state.progress.settings.defaultLevel || 5, true);
    setMode(state.currentMode || 'anatomy');
    switchAppSpace('home');
  }

  init().catch((err) => {
    console.error('Init failed:', err);
    $('boardFeedback').textContent = `Lỗi khởi tạo ứng dụng: ${err.message}`;
    $('boardFeedback').className = 'board-feedback warn';
  });
})();
