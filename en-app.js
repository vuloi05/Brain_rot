(() => {
  'use strict';

  const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const QUICK_ROOT_IDS = ['spect', 'struct', 'dict', 'port', 'tract', 'scrib', 'form', 'press'];
  const BATCH_LIMIT = 150;

  const enState = {
    loaded: false,
    loadingPromise: null,
    roots: [],
    rootsById: Object.create(null),
    prefixes: [],
    suffixes: [],
    vocab: [],
    vocabByWord: Object.create(null),
    top10kLoaded: false,
    top10kLoadingPromise: null,
    top10k: [],
    top10kByWord: Object.create(null),
    lookupCache: Object.create(null),
    lookupSeq: 0,
    jumpSeq: 0,
    enterSpaceSeq: 0,

    currentView: 'enAtelier', // 'enAtelier' | 'enDue' | 'enSquadron' | 'enReader' | 'neuro'
    currentLevel: 'A1',
    currentRootFilter: '',
    currentStatusFilter: 'today',
    sessionFailedSet: new Set(),
    searchQuery: '',
    global10k: false,
    currentMode: 'anatomy', // 'anatomy' | 'cloze' | 'spelling'

    filteredList: [],
    renderedCount: 0,
    currentWord: null,
    sessionRestored: false,
    skipNextRestore: false,
    _pendingJumpWord: null,
    _enterSpacePromise: null,
    noteTimer: null,
  };

  const enReaderState = {
    readingsLoaded: false,
    readingsLoadingPromise: null,
    readings: [],
    currentLevel: 'A1',
    filter: 'all', // 'all' | 'unread' | 'done' | 'custom'
    searchQuery: '',
    mode: 'paragraph', // 'paragraph' | 'full'
    showAllTrans: false,
    currentReading: null,
    unlockedIdx: 0,
    allUnlocked: false,
    activeParaIdx: 0,
    paraTransOpen: Object.create(null),
    selectedToken: null, // { paraIdx, tokenIdx, rawWord, targetWord, resolved }
    lookupSeq: 0,
  };

  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  function getBridge() {
    return window.BokusekiApp;
  }

  function getEnProgressMap() {
    const prog = getBridge()?.getProgress();
    if (!prog) return Object.create(null);
    if (!prog.enVocab) prog.enVocab = {};
    return prog.enVocab;
  }

  function getEnRecord(word) {
    const map = getEnProgressMap();
    return Object.hasOwn(map, word) ? map[word] : undefined;
  }

  function saveEnSessionState() {
    const bridge = getBridge();
    const prog = bridge?.getProgress?.();
    if (!prog || !prog.settings) return;
    prog.settings.enLevel = enState.currentLevel;
    prog.settings.enGlobal10k = Boolean(enState.global10k);
    prog.settings.enStatusFilter = enState.currentStatusFilter;
    prog.settings.enRootFilter = enState.currentRootFilter;
    if (enState.currentWord) {
      prog.settings.enLastWord = enState.currentWord.w;
    }
    bridge.saveProgress(true);
  }

  function getLocalDateKey() {
    if (getBridge()?.getLocalDateKey) return getBridge().getLocalDateKey();
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function updateTodayBadge() {
    const bridge = getBridge();
    const prog = bridge?.getProgress ? bridge.getProgress() : null;
    const s = prog?.settings;
    const todayStr = getLocalDateKey();
    if (s) {
      if (!s.enDailyNewLimit) s.enDailyNewLimit = 10;
      if (s.enDailyNewDate !== todayStr) {
        s.enDailyNewDate = todayStr;
        s.enDailyNewCount = 0;
      }
    }
    const dueCount = bridge ? (bridge.getDueEnWords ? bridge.getDueEnWords().length : 0) : 0;
    const remainingNew = Math.max(0, (s?.enDailyNewLimit || 10) - (s?.enDailyNewCount || 0));
    const totalToday = dueCount + remainingNew + enState.sessionFailedSet.size;

    if ($('enTodayBadge')) $('enTodayBadge').textContent = String(totalToday);
    if ($('enDailyLimitSelect') && s?.enDailyNewLimit) {
      $('enDailyLimitSelect').value = String(s.enDailyNewLimit);
    }
  }

  function getWordStatus(word) {
    const rec = getEnRecord(word);
    const fn = getBridge()?.computeSrsStatus;
    return fn ? fn(rec) : 'new';
  }

  function speakEnglish(text, lang = 'en-US', rate = 0.92) {
    if (!text || !('speechSynthesis' in window)) return;
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang;
    utt.rate = rate;
    const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const matched = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(lang.toLowerCase()));
    if (matched) utt.voice = matched;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  }

  function escapeRegex(str) {
    return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function lemmatizeCandidates(rawWord) {
    const clean = String(rawWord || '')
      .trim()
      .toLowerCase()
      .replace(/’/g, "'")
      .replace(/^[^a-z]+|[^a-z]+$/g, '');
    if (!clean) return [];
    const base = clean.replace(/'s$/i, '').replace(/'$/i, '');
    const out = [base];
    const add = (cand) => {
      if (cand && cand.length >= 2 && !out.includes(cand)) out.push(cand);
    };

    if (base.endsWith('ies') && base.length > 4) add(`${base.slice(0, -3)}y`);
    if (base.endsWith('es') && base.length > 3) add(base.slice(0, -2));
    if (base.endsWith('s') && base.length > 2 && !base.endsWith('ss')) add(base.slice(0, -1));

    if (base.endsWith('ied') && base.length > 4) add(`${base.slice(0, -3)}y`);
    if (base.endsWith('ed') && base.length > 4) {
      const stem = base.slice(0, -2);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
        add(stem.slice(0, -1));
      }
      add(stem);
      add(`${stem}e`);
    }
    if (base.endsWith('d') && base.length > 3) add(base.slice(0, -1));

    if (base.endsWith('ing') && base.length >= 5) {
      const stem = base.slice(0, -3);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
        add(stem.slice(0, -1));
      }
      add(stem);
      add(`${stem}e`);
    }

    if (base.endsWith('ily') && base.length > 4) add(`${base.slice(0, -3)}y`);
    if (base.endsWith('ly') && base.length > 4) add(base.slice(0, -2));

    if (base.endsWith('ier') && base.length > 4) add(`${base.slice(0, -3)}y`);
    if (base.endsWith('iest') && base.length > 5) add(`${base.slice(0, -4)}y`);
    if (base.endsWith('er') && base.length > 4) {
      const stem = base.slice(0, -2);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
        add(stem.slice(0, -1));
      }
      add(stem);
      add(`${stem}e`);
    }
    if (base.endsWith('est') && base.length > 5) {
      const stem = base.slice(0, -3);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
        add(stem.slice(0, -1));
      }
      add(stem);
      add(`${stem}e`);
    }

    return out;
  }

  function autoSegment(rawWord) {
    const w = String(rawWord || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return { rootId: '', parts: [] };

    let prefixPart = null;
    let rest = w;

    const prefixCands = [];
    (enState.prefixes || []).forEach((p) => {
      const variants = Array.isArray(p.variants) && p.variants.length
        ? p.variants
        : [String(p.text || '').replace(/-+$/, '')];
      variants.forEach((v) => {
        const cleanV = String(v || '').toLowerCase();
        if (cleanV) prefixCands.push({ v: cleanV, meaningVi: p.meaningVi || 'tiền tố' });
      });
    });
    prefixCands.sort((a, b) => b.v.length - a.v.length);
    for (const cand of prefixCands) {
      if (rest.startsWith(cand.v) && rest.length - cand.v.length >= 3) {
        prefixPart = { type: 'prefix', text: `${cand.v}-`, meaningVi: cand.meaningVi };
        rest = rest.slice(cand.v.length);
        break;
      }
    }

    let suffixPart = null;
    const suffixCands = [];
    (enState.suffixes || []).forEach((s) => {
      const variants = Array.isArray(s.variants) && s.variants.length
        ? s.variants
        : [String(s.text || '').replace(/^-+/, '')];
      variants.forEach((v) => {
        const cleanV = String(v || '').toLowerCase();
        if (cleanV) suffixCands.push({ v: cleanV, meaningVi: s.meaningVi || 'hậu tố' });
      });
    });
    suffixCands.sort((a, b) => b.v.length - a.v.length);
    for (const cand of suffixCands) {
      if (rest.endsWith(cand.v) && rest.length - cand.v.length >= 2) {
        suffixPart = { type: 'suffix', text: `-${cand.v}`, meaningVi: cand.meaningVi };
        rest = rest.slice(0, rest.length - cand.v.length);
        break;
      }
    }

    let matchedRoot = null;
    const stemCands = [];
    (enState.roots || []).forEach((r) => {
      (r.stems || []).forEach((st) => {
        const cleanS = String(st || '').toLowerCase();
        if (cleanS) stemCands.push({ st: cleanS, root: r });
      });
    });
    stemCands.sort((a, b) => b.st.length - a.st.length);
    for (const sc of stemCands) {
      if (rest.includes(sc.st)) {
        matchedRoot = sc.root;
        break;
      }
    }
    if (!matchedRoot) {
      for (const sc of stemCands) {
        if (w.includes(sc.st)) {
          matchedRoot = sc.root;
          break;
        }
      }
    }

    const rootMeaning = matchedRoot
      ? matchedRoot.meaningVi
      : (prefixPart || suffixPart ? 'gốc thân từ' : 'gốc từ đơn lập');
    const parts = [];
    if (prefixPart) parts.push(prefixPart);
    parts.push({ type: 'root', text: rest || w, meaningVi: rootMeaning });
    if (suffixPart) parts.push(suffixPart);

    return {
      rootId: matchedRoot ? matchedRoot.id : '',
      parts,
    };
  }

  // --- Data Loading ---
  async function ensureEnDataLoaded() {
    if (enState.loaded) return;
    if (enState.loadingPromise) return enState.loadingPromise;

    enState.loadingPromise = (async () => {
      const [rootsRes, vocabRes] = await Promise.all([
        fetch('data/en-roots.json'),
        fetch('data/en-vocab.json'),
      ]);
      const rootsData = await rootsRes.json();
      const vocabData = await vocabRes.json();

      enState.roots = rootsData.roots || [];
      enState.prefixes = rootsData.prefixes || [];
      enState.suffixes = rootsData.suffixes || [];
      enState.rootsById = Object.create(null);
      enState.roots.forEach((r) => {
        enState.rootsById[r.id] = r;
      });

      enState.vocab = Array.isArray(vocabData) ? vocabData : [];
      enState.vocabByWord = Object.create(null);
      enState.vocab.forEach((v) => {
        enState.vocabByWord[v.w] = v;
      });

      enState.loaded = true;
      populateHeaderCounts();
      populateRootSelect();
      renderHomeQuickRoots();
      getBridge()?.renderHomeHub?.();
    })();

    return enState.loadingPromise;
  }

  async function ensureTop10kLoaded() {
    if (enState.top10kLoaded) return enState.top10k;
    if (enState.top10kLoadingPromise) return enState.top10kLoadingPromise;

    enState.top10kLoadingPromise = (async () => {
      const res = await fetch('data/en-freq-top10k.json');
      const data = await res.json();
      enState.top10k = Array.isArray(data) ? data : [];
      const byWord = Object.create(null);
      enState.top10k.forEach((item) => {
        if (item && item.w) byWord[String(item.w).trim().toLowerCase()] = item;
      });
      enState.top10kByWord = byWord;
      enState.top10kLoaded = true;
      return enState.top10k;
    })();

    return enState.top10kLoadingPromise;
  }

  function populateHeaderCounts() {
    if (enState.currentView === 'enReader' && enReaderState.readingsLoaded) {
      populateReaderLevelCounts();
      return;
    }
    const counts = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };
    const source = enState.global10k && enState.top10kLoaded ? enState.top10k : enState.vocab;
    source.forEach((v) => {
      if (counts[v.lvl] !== undefined) counts[v.lvl] += 1;
    });
    CEFR_LEVELS.forEach((lvl) => {
      const span = document.querySelector(`#enLevelTabs .en-level-btn[data-enlevel="${lvl}"] .lvl-count`);
      if (span) span.textContent = String(counts[lvl]);
    });
  }

  function populateReaderLevelCounts() {
    const counts = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };
    const prog = getBridge()?.getProgress?.();
    const customList = Array.isArray(prog?.enCustomReadings) ? prog.enCustomReadings : [];
    [...customList, ...enReaderState.readings].forEach((r) => {
      if (counts[r.level] !== undefined) counts[r.level] += 1;
    });
    CEFR_LEVELS.forEach((lvl) => {
      const span = document.querySelector(`#enLevelTabs .en-level-btn[data-enlevel="${lvl}"] .lvl-count`);
      if (span) span.textContent = String(counts[lvl]);
    });
  }

  function populateRootSelect() {
    const sel = $('enRootFilterSelect');
    if (!sel || sel.options.length > 1) return;
    const allRootsOpt = document.createElement('option');
    allRootsOpt.value = '__all__';
    allRootsOpt.textContent = `Tất cả 36 gốc từ (${enState.vocab.length} từ trọng tâm)`;
    sel.appendChild(allRootsOpt);

    enState.roots.forEach((r) => {
      const cnt = enState.vocab.filter((v) => v.rootId === r.id).length;
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = `${r.root} — ${r.meaningVi} (${cnt} từ)`;
      sel.appendChild(opt);
    });
  }

  function renderHomeQuickRoots() {
    const box = $('homeEnQuickRoots');
    if (!box || !enState.roots.length) return;
    box.innerHTML = '';
    QUICK_ROOT_IDS.forEach((rid) => {
      const r = enState.rootsById[rid];
      if (!r) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'related-chip';
      chip.title = `${r.origin}: ${r.meaningVi}`;
      chip.innerHTML = `<span class="mono" style="font-weight:700;color:var(--accent-indigo);">${escapeHtml(r.root)}</span><span>${escapeHtml((r.meaningVi || '').split(',')[0])}</span>`;
      chip.addEventListener('click', async () => {
        await ensureEnDataLoaded();
        enState.skipNextRestore = true;
        enState.currentRootFilter = rid;
        enState.currentStatusFilter = 'all';
        if ($('enRootFilterSelect')) $('enRootFilterSelect').value = rid;
        syncStatusChips();
        saveEnSessionState();
        getBridge()?.switchAppSpace('en', 'enAtelier');
      });
      box.appendChild(chip);
    });
  }

  // --- Filtering & List Rendering ---
  function syncLevelButtons() {
    const activeLvl = enState.currentView === 'enReader' ? enReaderState.currentLevel : enState.currentLevel;
    qsa('#enLevelTabs .en-level-btn').forEach((b) => {
      const isActive = enState.currentView === 'enReader'
        ? b.dataset.enlevel === activeLvl
        : (!enState.currentRootFilter && b.dataset.enlevel === activeLvl);
      b.classList.toggle('active', isActive);
    });
  }

  function syncStatusChips() {
    qsa('.en-filter-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.enfilter === enState.currentStatusFilter);
    });
  }

  function syncViewTabs(viewName) {
    enState.currentView = viewName;
    qsa('#enViewTabs .en-view-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.enview === viewName);
    });
  }

  function matchesEnQuery(entry, q, normQ) {
    if (!q) return true;
    const bridge = getBridge();
    const strip = bridge?.stripVietnamese || ((s) => s.toLowerCase());
    if (entry.w.toLowerCase().includes(q)) return true;
    if (entry.rootId && entry.rootId.toLowerCase().includes(q)) return true;
    if (entry.vi && strip(entry.vi).includes(normQ)) return true;
    if (entry.enDef && entry.enDef.toLowerCase().includes(q)) return true;
    if (entry.ipa && entry.ipa.toLowerCase().includes(q)) return true;
    if (entry.parts && entry.parts.some((p) => p.text.toLowerCase().includes(q))) return true;
    return false;
  }

  function makeCorpusStubEntry(item) {
    const rootInfo = enState.rootsById[item.rootId];
    return {
      w: item.w,
      lvl: item.lvl || 'B1',
      rank: item.rank || 5000,
      freqCount: item.freqCount || 0,
      ipa: `/${item.w}/`,
      pos: 'corpus 10k',
      vi: 'Đang tra nghĩa Tiếng Việt...',
      enDef: 'Corpus word from Google top-10k vocabulary.',
      rootId: item.rootId || '',
      parts: item.autoParts || [{ type: 'root', text: item.w, meaningVi: 'gốc từ nguyên khối' }],
      etymologyNote: rootInfo
        ? `Tách tự động thuộc gốc "${rootInfo.root}" (${rootInfo.meaningVi}).`
        : 'Từ thông dụng từ kho tần suất Google 10.000 từ (bóc tách tiền tố/hậu tố tự động).',
      collocations: [],
      exampleEn: '',
      exampleVi: '',
      family: [],
      _isCorpusOnly: true,
    };
  }

  function makeEntryFromRecord(word, rec) {
    const cleanW = String(word || '').trim().toLowerCase();
    if (enState.vocabByWord[cleanW]) return enState.vocabByWord[cleanW];
    const tItem = enState.top10kByWord[cleanW];
    const meta = rec?.meta || {};
    const cached = enState.lookupCache[cleanW];
    const auto = autoSegment(cleanW);
    const rootId = meta.rootId || tItem?.rootId || auto.rootId || '';
    const rootInfo = enState.rootsById[rootId];
    const parts = (Array.isArray(meta.parts) && meta.parts.length)
      ? meta.parts
      : (Array.isArray(tItem?.autoParts) && tItem.autoParts.length)
        ? tItem.autoParts
        : (auto.parts.length ? auto.parts : [{ type: 'root', text: cleanW, meaningVi: 'gốc từ nguyên khối' }]);
    return {
      w: cleanW,
      lvl: meta.lvl || tItem?.lvl || 'B1',
      rank: tItem?.rank || meta.rank || 9999,
      freqCount: tItem?.freqCount || 0,
      ipa: cached?.ipa || meta.ipa || `/${cleanW}/`,
      pos: cached?.pos || meta.pos || (tItem ? 'corpus 10k' : 'word'),
      vi: cached?.vi || meta.vi || 'Đang tra nghĩa Tiếng Việt...',
      enDef: cached?.enDef || meta.enDef || (tItem ? 'Corpus word from Google top-10k vocabulary.' : 'Từ vựng lưu từ bài đọc sâu.'),
      rootId,
      parts,
      etymologyNote: rootInfo
        ? `Tách tự động thuộc gốc "${rootInfo.root}" (${rootInfo.meaningVi}).`
        : 'Từ vựng từ kho mở rộng / bài đọc sâu (bóc tách tiền tố/hậu tố tự động).',
      collocations: [],
      exampleEn: cached?.exampleEn || meta.exampleEn || '',
      exampleVi: '',
      family: [],
      _isCorpusOnly: true,
    };
  }

  function getSortTier(item) {
    if (enState.vocabByWord[item.w]) return 0;
    if (item.rootId) return 1;
    return 2;
  }

  function getAllDueEnEntries() {
    const map = getEnProgressMap();
    const seen = new Set();
    const out = [];
    Object.entries(map).forEach(([w, rec]) => {
      const key = String(w || '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      if (getWordStatus(w) === 'due') {
        seen.add(key);
        out.push(makeEntryFromRecord(key, rec));
      }
    });
    return out;
  }

  async function applyFilterAndRender(pickFirst = false) {
    await ensureEnDataLoaded();
    syncLevelButtons();

    const rawQ = (enState.searchQuery || '').trim().toLowerCase();
    const normQ = (getBridge()?.stripVietnamese || ((s) => s.toLowerCase()))(rawQ);

    let list = [];
    let scopeLabel = enState.currentRootFilter
      ? (enState.currentRootFilter === '__all__' ? '36 gốc từ' : `Gốc ${enState.rootsById[enState.currentRootFilter]?.root || enState.currentRootFilter}`)
      : enState.currentLevel;

    if (enState.currentStatusFilter === 'today') {
      const bridge = getBridge();
      const prog = bridge?.getProgress?.();
      const s = prog?.settings;
      const todayStr = getLocalDateKey();
      if (s) {
        if (!s.enDailyNewLimit) s.enDailyNewLimit = 10;
        if (s.enDailyNewDate !== todayStr) {
          s.enDailyNewDate = todayStr;
          s.enDailyNewCount = 0;
        }
      }

      let sourcePool;
      if (enState.global10k) {
        await ensureTop10kLoaded();
        populateHeaderCounts();
        const base = enState.top10k.filter((it) => {
          if (enState.currentRootFilter && enState.currentRootFilter !== '__all__') {
            return it.rootId === enState.currentRootFilter;
          }
          if (!enState.currentRootFilter) return it.lvl === enState.currentLevel;
          return true;
        });
        sourcePool = [...base].sort((a, b) => {
          const ta = getSortTier(a);
          const tb = getSortTier(b);
          if (ta !== tb) return ta - tb;
          return (a.rank || 99999) - (b.rank || 99999);
        });
      } else {
        populateHeaderCounts();
        if (enState.currentRootFilter && enState.currentRootFilter !== '__all__') {
          sourcePool = enState.vocab.filter((v) => v.rootId === enState.currentRootFilter);
        } else if (enState.currentRootFilter === '__all__') {
          sourcePool = enState.vocab;
        } else {
          sourcePool = enState.vocab.filter((v) => v.lvl === enState.currentLevel);
        }
      }

      // 1. Due items (pool + any non-253 enVocab due items not in sessionFailedSet)
      const dueMap = new Map();
      sourcePool.forEach((it) => {
        if (getWordStatus(it.w) === 'due' && !enState.sessionFailedSet.has(it.w)) {
          dueMap.set(it.w, enState.vocabByWord[it.w] || makeCorpusStubEntry(it));
        }
      });
      getAllDueEnEntries().forEach((entry) => {
        if (!dueMap.has(entry.w) && !enState.sessionFailedSet.has(entry.w)) {
          if (enState.currentRootFilter && enState.currentRootFilter !== '__all__') {
            if (entry.rootId !== enState.currentRootFilter) return;
          } else if (!enState.currentRootFilter && entry.lvl !== enState.currentLevel) {
            return;
          }
          dueMap.set(entry.w, entry);
        }
      });
      const dueItems = Array.from(dueMap.values());

      // 2. New items up to quota
      const remainingNew = Math.max(0, (s?.enDailyNewLimit || 10) - (s?.enDailyNewCount || 0));
      const allNew = sourcePool.filter((it) => getWordStatus(it.w) === 'new' && !enState.sessionFailedSet.has(it.w));
      const newItems = allNew.slice(0, remainingNew).map((it) => enState.vocabByWord[it.w] || makeCorpusStubEntry(it));

      // 3. Session retry items
      const retryMap = new Map();
      sourcePool.forEach((it) => {
        if (enState.sessionFailedSet.has(it.w)) {
          retryMap.set(it.w, enState.vocabByWord[it.w] || makeCorpusStubEntry(it));
        }
      });
      enState.sessionFailedSet.forEach((w) => {
        if (!retryMap.has(w)) {
          retryMap.set(w, makeEntryFromRecord(w, getEnRecord(w)));
        }
      });
      const retryItems = Array.from(retryMap.values());

      const rawToday = [...dueItems, ...newItems, ...retryItems];
      list = rawToday.filter((entry) => matchesEnQuery(entry, rawQ, normQ));

      scopeLabel = `🔥 Hôm nay: ${list.length} từ (${dueItems.length} cần ôn + ${newItems.length} mới${retryItems.length ? ` + ${retryItems.length} ôn lại` : ''})`;
      enState.filteredList = list;
      $('enListMetaText').textContent = scopeLabel;
      updateTodayBadge();
      renderWordList('reset');

      if (pickFirst && list.length) {
        await selectWord(list[0]);
      } else if (!list.length && pickFirst) {
        enState.currentWord = null;
      }
      return;
    }

    if (enState.currentStatusFilter === 'due') {
      if (enState.global10k) await ensureTop10kLoaded();
      populateHeaderCounts();
      scopeLabel = enState.global10k ? 'Kho 10.000 · Cần ôn' : 'Đến hạn SRS';
      list = getAllDueEnEntries().filter((entry) => {
        if (enState.currentRootFilter && enState.currentRootFilter !== '__all__' && entry.rootId !== enState.currentRootFilter) {
          return false;
        }
        return matchesEnQuery(entry, rawQ, normQ);
      });
    } else if (enState.global10k) {
      await ensureTop10kLoaded();
      populateHeaderCounts();
      scopeLabel = `Kho 10.000 · ${enState.currentRootFilter && enState.currentRootFilter !== '__all__' ? scopeLabel : (enState.currentRootFilter === '__all__' ? 'Tất cả' : enState.currentLevel)}`;

      const sourcePool = rawQ
        ? enState.top10k.filter((it) => {
            if (enState.currentRootFilter && enState.currentRootFilter !== '__all__' && it.rootId !== enState.currentRootFilter) {
              return false;
            }
            const cur = enState.vocabByWord[it.w];
            if (cur) return matchesEnQuery(cur, rawQ, normQ);
            return it.w.includes(rawQ) || (it.rootId && it.rootId.includes(rawQ));
          })
        : enState.top10k.filter((it) => {
            if (enState.currentRootFilter && enState.currentRootFilter !== '__all__') {
              return it.rootId === enState.currentRootFilter;
            }
            if (!enState.currentRootFilter) return it.lvl === enState.currentLevel;
            return true;
          });

      const sorted = rawQ
        ? [...sourcePool].sort((a, b) => {
            const ap = a.w.startsWith(rawQ) ? 0 : 1;
            const bp = b.w.startsWith(rawQ) ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return (a.rank || 99999) - (b.rank || 99999);
          })
        : [...sourcePool].sort((a, b) => {
            const ta = getSortTier(a);
            const tb = getSortTier(b);
            if (ta !== tb) return ta - tb;
            return (a.rank || 99999) - (b.rank || 99999);
          });

      list = sorted
        .map((it) => enState.vocabByWord[it.w] || makeCorpusStubEntry(it))
        .filter((entry) => enState.currentStatusFilter === 'all' || getWordStatus(entry.w) === enState.currentStatusFilter);
    } else {
      populateHeaderCounts();
      let basePool;
      if (enState.currentRootFilter === '__all__') {
        basePool = enState.vocab;
      } else if (enState.currentRootFilter) {
        basePool = enState.vocab.filter((v) => v.rootId === enState.currentRootFilter);
      } else if (rawQ) {
        basePool = enState.vocab;
      } else {
        basePool = enState.vocab.filter((v) => v.lvl === enState.currentLevel);
      }

      list = basePool.filter((entry) => {
        if (enState.currentStatusFilter !== 'all' && getWordStatus(entry.w) !== enState.currentStatusFilter) {
          return false;
        }
        return matchesEnQuery(entry, rawQ, normQ);
      });
    }

    enState.filteredList = list;
    $('enListMetaText').textContent = `${scopeLabel}: ${list.length} từ`;
    renderWordList('reset');

    if (pickFirst && list.length) {
      await selectWord(list[0]);
    } else if (!list.length && pickFirst) {
      enState.currentWord = null;
    }
  }

  function renderWordList(action = 'reset') {
    const box = $('enWordList');
    if (!box) return;

    if (action === 'reset') {
      box.innerHTML = '';
      enState.renderedCount = 0;
    }

    const oldMore = box.querySelector('.load-more-btn');
    if (oldMore) oldMore.remove();

    if (!enState.filteredList.length) {
      if (enState.currentStatusFilter === 'today') {
        const prog = getBridge()?.getProgress();
        const s = prog?.settings;
        box.innerHTML = `
          <div class="today-complete-card">
            <div class="today-complete-icon">🎉</div>
            <h4>Hoàn thành mục tiêu hôm nay!</h4>
            <p>Bạn đã giải quyết sạch các từ cần ôn và đạt chỉ tiêu từ mới của ngày hôm nay.</p>
            <div class="today-complete-stats">
              <span class="stat-tag">Cần ôn: <strong>0 còn lại</strong></span>
              <span class="stat-tag">Đã nạp: <strong>${s?.enDailyNewCount || 0} / ${s?.enDailyNewLimit || 10} từ mới</strong></span>
            </div>
            <div class="today-complete-actions">
              <button type="button" class="btn btn-primary" id="enCompleteAddMoreBtn">+ Học thêm 5 từ mới</button>
              <button type="button" class="btn" id="enCompleteSquadronBtn">🎯 Bắn Phản Xạ từ vừa học</button>
              <button type="button" class="btn" id="enCompleteViewAllBtn">Xem tất cả từ vựng</button>
            </div>
          </div>
        `;
        box.querySelector('#enCompleteAddMoreBtn')?.addEventListener('click', async () => {
          if (s) {
            s.enDailyNewLimit = (s.enDailyNewLimit || 10) + 5;
            if ($('enDailyLimitSelect')) $('enDailyLimitSelect').value = String(s.enDailyNewLimit);
            getBridge()?.saveProgress(true);
            updateTodayBadge();
          }
          await applyFilterAndRender(true);
        });
        box.querySelector('#enCompleteSquadronBtn')?.addEventListener('click', () => {
          if ($('sqDeckSelect')) $('sqDeckSelect').value = 'learned_today';
          setEnMode('squadron');
        });
        box.querySelector('#enCompleteViewAllBtn')?.addEventListener('click', async () => {
          enState.currentStatusFilter = 'all';
          syncStatusChips();
          saveEnSessionState();
          await applyFilterAndRender(true);
        });
        return;
      }
      box.innerHTML = '<div class="rk-empty" style="padding:14px;">Không có từ khớp bộ lọc hiện tại.</div>';
      return;
    }

    const chunk = enState.filteredList.slice(enState.renderedCount, enState.renderedCount + BATCH_LIMIT);
    chunk.forEach((entry) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kanji-item';
      btn.dataset.word = entry.w;
      if (enState.currentWord && enState.currentWord.w === entry.w) btn.classList.add('active');

      const status = getWordStatus(entry.w);
      const subText = entry._isCorpusOnly
        ? `${entry.lvl} · #${entry.rank}${entry.rootId ? ` · gốc ${entry.rootId}` : ' · kho 10k'}`
        : `${entry.vi} · #${entry.rank}`;
      btn.innerHTML = `
        <span class="kanji-item-glyph" style="font-size:13px;font-family:var(--font-mono);min-width:34px;">${escapeHtml(entry.lvl)}</span>
        <span class="kanji-item-body">
          <div class="kanji-item-hv" style="font-size:14.5px;text-transform:none;">${escapeHtml(entry.w)}</div>
          <div class="kanji-item-vi">${escapeHtml(subText)}</div>
        </span>
        <span class="kanji-item-dot ${escapeHtml(status)}"></span>
      `;
      btn.addEventListener('click', () => selectWord(entry));
      box.appendChild(btn);
    });

    enState.renderedCount += chunk.length;
    if (enState.renderedCount < enState.filteredList.length) {
      const remaining = enState.filteredList.length - enState.renderedCount;
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'load-more-btn';
      moreBtn.textContent = `Tải thêm ${Math.min(BATCH_LIMIT, remaining)} từ tiếp theo (còn ${remaining} từ)`;
      moreBtn.addEventListener('click', () => renderWordList('append'));
      box.appendChild(moreBtn);
    }
  }

  function updateWordListDots() {
    qsa('#enWordList .kanji-item').forEach((btn) => {
      const dot = btn.querySelector('.kanji-item-dot');
      if (dot) dot.className = `kanji-item-dot ${getWordStatus(btn.dataset.word)}`;
    });
  }

  // --- Selecting & Rendering a Word ---
  async function selectWord(entryInput, saveSession = true) {
    let entry = entryInput;
    if (!entry) return;

    // Resolve curated version if available
    if (enState.vocabByWord[entry.w]) {
      entry = enState.vocabByWord[entry.w];
    } else if (entry._isCorpusOnly) {
      const recMeta = getEnRecord(entry.w)?.meta;
      const cached = enState.lookupCache[entry.w];
      if (recMeta || cached) {
        entry = {
          ...entry,
          ...(recMeta ? {
            ipa: recMeta.ipa || entry.ipa,
            pos: recMeta.pos || entry.pos,
            vi: recMeta.vi || entry.vi,
            enDef: recMeta.enDef || entry.enDef,
            rootId: recMeta.rootId || entry.rootId,
            parts: Array.isArray(recMeta.parts) && recMeta.parts.length ? recMeta.parts : entry.parts,
          } : {}),
          ...(cached || {}),
        };
      }
    }

    enState.currentWord = entry;
    qsa('#enStickySrsFooter .en-srs-btn').forEach((b) => b.classList.remove('srs-suggested'));
    qsa('#enWordList .kanji-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.word === entry.w);
    });
    if (saveSession) saveEnSessionState();

    renderPromptStrip(entry);
    renderAnatomyPane(entry);
    renderClozePane(entry);
    renderSpellingPane(entry);
    renderRightPanel(entry);

    const needsLookup = entry._isCorpusOnly
      && !enState.lookupCache[entry.w]
      && (!entry.vi || entry.vi === 'Đang tra nghĩa Tiếng Việt...' || entry.vi === 'Chưa có nghĩa trực tuyến');

    if (needsLookup) {
      const seq = ++enState.lookupSeq;
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const fetchTimer = ac ? setTimeout(() => ac.abort(), 4500) : null;
      try {
        const res = await fetch(
          `/api/en-lookup?word=${encodeURIComponent(entry.w)}`,
          ac ? { signal: ac.signal } : undefined
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok) {
            const enriched = {
              ipa: data.ipa || entry.ipa,
              pos: data.pos || 'word',
              vi: data.vi || 'Chưa có nghĩa trực tuyến',
              enDef: data.enDef || entry.enDef,
              exampleEn: data.exampleEn || '',
            };
            if (data.found && !data.offline) {
              enState.lookupCache[entry.w] = enriched;
            }
            if (seq === enState.lookupSeq && enState.currentWord && enState.currentWord.w === entry.w) {
              Object.assign(enState.currentWord, enriched);
              renderPromptStrip(enState.currentWord);
              renderAnatomyPane(enState.currentWord);
              renderClozePane(enState.currentWord);
            }
          }
        } else if (seq === enState.lookupSeq && enState.currentWord && enState.currentWord.w === entry.w) {
          $('enPromptVi').textContent = 'Chưa có nghĩa trực tuyến (dùng giải phẫu gốc từ bên dưới).';
        }
      } catch (_) {
        if (seq === enState.lookupSeq && enState.currentWord && enState.currentWord.w === entry.w) {
          $('enPromptVi').textContent = 'Không kết nối được từ điển trực tuyến (dùng giải phẫu gốc từ bên dưới).';
        }
      } finally {
        if (fetchTimer) clearTimeout(fetchTimer);
      }
    }
  }

  function renderPromptStrip(entry) {
    const isBlind = enState.currentMode === 'spelling';
    const wordEl = $('enPromptWord');
    wordEl.textContent = isBlind ? '•'.repeat(entry.w.length) : entry.w;
    wordEl.classList.toggle('masked', isBlind);

    $('enPromptIpa').textContent = entry.ipa || `/${entry.w}/`;
    $('enPromptPos').textContent = entry.pos || 'word';
    $('enPromptRankTag').textContent = `CEFR ${entry.lvl} · Hạng #${entry.rank || '—'}`;
    $('enPromptVi').textContent = entry.vi || '—';
    $('enPromptEnDef').textContent = isBlind
      ? '(Đang che mặt chữ — hãy nghe âm hoặc dựa vào nghĩa + gợi ý gốc từ)'
      : (entry.enDef || '');
  }

  function renderAnatomyPane(entry) {
    const eqBox = $('enMorphEquation');
    eqBox.innerHTML = '';

    const parts = entry.parts || [{ type: 'root', text: entry.w, meaningVi: entry.vi }];
    parts.forEach((part, idx) => {
      if (idx > 0) {
        const op = document.createElement('div');
        op.className = 'morph-op';
        op.textContent = '+';
        eqBox.appendChild(op);
      }
      const block = document.createElement('div');
      block.className = `morph-block ${part.type || 'root'}`;
      const typeLabel = { prefix: 'Tiền tố (Prefix)', root: 'Gốc từ (Root)', suffix: 'Hậu tố (Suffix)' }[part.type] || 'Thành tố';
      block.innerHTML = `
        <div class="morph-block-tag">${escapeHtml(typeLabel)}</div>
        <div class="morph-block-text">${escapeHtml(part.text)}</div>
        <div class="morph-block-vi">${escapeHtml(part.meaningVi || '—')}</div>
      `;
      if (part.type === 'root' && entry.rootId && enState.rootsById[entry.rootId]) {
        block.style.cursor = 'pointer';
        block.title = 'Bấm để lọc toàn bộ từ cùng gốc này';
        block.addEventListener('click', () => {
          enState.currentRootFilter = entry.rootId;
          enState.global10k = false;
          if ($('enGlobal10kToggle')) $('enGlobal10kToggle').checked = false;
          if ($('enRootFilterSelect')) $('enRootFilterSelect').value = entry.rootId;
          applyFilterAndRender(false);
        });
      }
      eqBox.appendChild(block);
    });

    $('enEtymologyNote').textContent = entry.etymologyNote || '';

    const colBox = $('enCollocationsBox');
    colBox.innerHTML = '';
    const cols = entry.collocations || [];
    if (!cols.length) {
      colBox.innerHTML = '<span class="sub-hint">Chưa có cụm từ đi kèm sẵn cho từ mở rộng này.</span>';
    } else {
      cols.forEach((c) => {
        const wrap = document.createElement('div');
        wrap.className = 'collocation-card-wrap';

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'collocation-chip';
        chip.innerHTML = `
          <span class="collocation-phrase">🔊 ${escapeHtml(c.phrase)}</span>
          <span class="collocation-vi">${escapeHtml(c.vi)}</span>
        `;
        chip.addEventListener('click', () => speakEnglish(c.phrase, 'en-US', 0.9));

        const ygBtn = document.createElement('button');
        ygBtn.type = 'button';
        ygBtn.className = 'collocation-yg-btn';
        ygBtn.title = `Nghe cụm "${c.phrase}" trong video thực tế (YouGlish)`;
        ygBtn.textContent = '🎬';
        ygBtn.addEventListener('click', () => {
          window.MediaCoach?.openYouGlish(c.phrase, 'english', '', 'enMediaCoachMount');
        });

        wrap.appendChild(chip);
        wrap.appendChild(ygBtn);
        colBox.appendChild(wrap);
      });
    }

    if (entry.exampleEn) {
      $('enExampleEn').textContent = entry.exampleEn;
      $('enExampleVi').textContent = entry.exampleVi || '';
      $('enSpeakExampleBtn').classList.remove('hidden');
    } else {
      $('enExampleEn').textContent = 'Chưa có câu ví dụ mẫu cho từ này.';
      $('enExampleVi').textContent = '';
      $('enSpeakExampleBtn').classList.add('hidden');
    }
  }

  function renderClozePane(entry) {
    const rInfo = enState.rootsById[entry.rootId];
    $('enClozeRootHint').textContent = rInfo ? `Gốc: ${rInfo.root} (${rInfo.meaningVi.split(',')[0]})` : `Từ: ${entry.lvl}`;
    $('enClozeInput').value = '';
    const fb = $('enClozeFeedback');
    fb.classList.add('hidden');
    fb.classList.remove('ok', 'warn');

    if (!entry.exampleEn) {
      $('enClozeSentence').innerHTML = '<span class="sub-hint">Từ mở rộng chưa có câu ví dụ để điền khuyết — hãy chuyển sang Giải phẫu hoặc Gõ chính tả mù.</span>';
      $('enClozeViHint').textContent = `Nghĩa: ${entry.vi}`;
      enState._clozeTarget = entry.w;
      return;
    }

    const pattern = new RegExp(`\\b(${escapeRegex(entry.w)}[a-z]*)\\b`, 'i');
    const m = entry.exampleEn.match(pattern);
    enState._clozeTarget = m ? m[1] : entry.w;
    let maskedHtml;
    if (m && typeof m.index === 'number') {
      const before = entry.exampleEn.slice(0, m.index);
      const after = entry.exampleEn.slice(m.index + m[0].length);
      maskedHtml = `${escapeHtml(before)}<span class="en-cloze-blank">_____</span>${escapeHtml(after)}`;
    } else {
      maskedHtml = `${escapeHtml(entry.exampleEn)} [<span class="en-cloze-blank">_____</span>]`;
    }

    $('enClozeSentence').innerHTML = maskedHtml;
    $('enClozeViHint').textContent = entry.exampleVi ? `Gợi ý câu: ${entry.exampleVi}` : `Nghĩa từ cần điền: ${entry.vi}`;
  }

  function renderSpellingPane(entry) {
    $('enSpellingInput').value = '';
    $('enSpellingHintText').classList.add('hidden');
    $('enSpellingHintText').textContent = '';
    const resEl = $('enSpellingResult');
    resEl.classList.add('hidden');
    resEl.classList.remove('ok', 'warn');
  }

  function computeEditDistance(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  }

  function renderNearbyWords(entry) {
    const box = $('enNearbyWordsList');
    if (!box) return;
    box.innerHTML = '';

    const target = entry.w.toLowerCase();
    const seen = new Set([target]);
    const scored = [];
    const pool = enState.top10kLoaded ? [...enState.vocab, ...enState.top10k] : enState.vocab;
    const suf3 = target.slice(-3);
    const pre3 = target.slice(0, 3);

    for (const item of pool) {
      const cw = item.w.toLowerCase();
      if (seen.has(cw) || cw.length < 4) continue;
      seen.add(cw);
      if (Math.abs(cw.length - target.length) > 2) continue;
      const sameHead = cw[0] === target[0];
      const sameSuf3 = target.length >= 4 && cw.slice(-3) === suf3;
      const samePre3 = target.length >= 4 && cw.slice(0, 3) === pre3;
      if (!sameHead && !sameSuf3 && !samePre3) continue;

      const dist = computeEditDistance(target, cw);
      const maxAllow = target.length <= 6 ? 2 : 3;
      if (dist <= maxAllow || (sameSuf3 && Math.abs(cw.length - target.length) <= 1)) {
        scored.push({
          w: item.w,
          rank: item.rank || 9999,
          lvl: item.lvl || 'B1',
          dist,
          curated: Boolean(enState.vocabByWord[item.w]),
        });
      }
    }

    scored.sort((a, b) => a.dist - b.dist || (a.curated === b.curated ? a.rank - b.rank : (a.curated ? -1 : 1)));
    const top = scored.slice(0, 10);

    if (!top.length) {
      box.innerHTML = '<span class="sub-hint">Chưa có từ gần âm/chính tả tương tự.</span>';
      return;
    }

    top.forEach((it) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'nearby-chip';
      chip.title = `Bấm để đối chiếu với "${it.w}" (Hạng #${it.rank})`;
      chip.innerHTML = `<strong>${escapeHtml(it.w)}</strong> <span class="mono sub-hint">#${escapeHtml(it.rank)}</span>`;
      chip.addEventListener('click', async () => {
        const curMeta = enState.vocabByWord[it.w];
        if (curMeta) {
          await selectWord(curMeta);
        } else {
          await ensureTop10kLoaded();
          const found10k = enState.top10k.find((x) => x.w === it.w);
          const stub = found10k
            ? makeCorpusStubEntry(found10k)
            : makeCorpusStubEntry({ w: it.w, rank: it.rank, lvl: it.lvl, rootId: '' });
          await selectWord(stub);
        }
      });
      box.appendChild(chip);
    });
  }

  function renderRightPanel(entry) {
    const rootInfo = enState.rootsById[entry.rootId];
    $('enRootBadgeTag').textContent = rootInfo ? `${rootInfo.origin} · ${rootInfo.root}` : `CEFR ${entry.lvl}`;

    const summaryBox = $('enRootSummaryBox');
    if (rootInfo) {
      summaryBox.innerHTML = `
        <div style="font-weight:700;color:var(--accent-indigo);margin-bottom:3px;">Gốc ${escapeHtml(rootInfo.root)} (${escapeHtml(rootInfo.origin)})</div>
        <div><strong>Nghĩa gốc:</strong> ${escapeHtml(rootInfo.meaningVi)}</div>
        <div class="sub-hint" style="margin-top:2px;">English core: "${escapeHtml(rootInfo.meaningEn)}"</div>
      `;
    } else {
      summaryBox.innerHTML = `<div>Từ thông dụng #${escapeHtml(entry.rank)} (${escapeHtml(entry.lvl)}). Các thành tố tiền tố/hậu tố đã tách ở khung giữa.</div>`;
    }

    const famBox = $('enFamilyList');
    famBox.innerHTML = '';
    let famItems = Array.isArray(entry.family) ? entry.family : [];
    if (!famItems.length && rootInfo) {
      const sampleCurated = enState.vocab.filter((v) => v.rootId === rootInfo.id);
      if (sampleCurated.length && sampleCurated[0].family) famItems = sampleCurated[0].family;
    }

    if (!famItems.length) {
      famBox.innerHTML = '<span class="sub-hint">Từ đơn lập hoặc chưa nhóm vào 36 gốc Latin/Hy Lạp.</span>';
    } else {
      famItems.forEach((fm) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `en-family-item${fm.w === entry.w ? ' active' : ''}`;
        const curMeta = enState.vocabByWord[fm.w];
        const tag = curMeta ? curMeta.vi.split(',')[0] : (fm.lvl || '20k');
        btn.innerHTML = `
          <span><strong>${escapeHtml(fm.w)}</strong> <span class="sub-hint">· ${escapeHtml(tag)}</span></span>
          <span class="en-family-rank">#${escapeHtml(fm.rank)}</span>
        `;
        btn.addEventListener('click', async () => {
          if (curMeta) {
            await selectWord(curMeta);
          } else {
            await ensureTop10kLoaded();
            const found10k = enState.top10k.find((x) => x.w === fm.w);
            const target = found10k
              ? makeCorpusStubEntry(found10k)
              : makeCorpusStubEntry({ w: fm.w, rank: fm.rank, lvl: fm.lvl, rootId: entry.rootId });
            await selectWord(target);
          }
        });
        famBox.appendChild(btn);
      });
    }

    const rec = getEnRecord(entry.w) || {};
    $('enMnemonicInput').value = rec.note || '';
    $('enNoteSaveHint').textContent = 'Tự lưu vào ổ đĩa';

    const bridge = getBridge();
    const status = getWordStatus(entry.w);
    const statusText = {
      new: 'Chưa học',
      due: 'Cần ôn ngay',
      learning: `Đang luyện (${rec.interval || 0} ngày)`,
      mastered: `Thuộc sâu (${rec.interval || 0} ngày)`,
    }[status];
    $('enSrsStatusText').textContent = statusText;

    [1, 2, 3, 4].forEach((q) => {
      const span = $(`enSrsInterval${q}`);
      if (span && bridge?.previewSrsRecord) {
        span.textContent = bridge.previewSrsRecord(rec, q);
      }
    });

    renderNearbyWords(entry);
    window.MediaCoach?.syncTarget?.({
      word: entry.w,
      sentence: entry.exampleEn || '',
      lang: 'en-US',
      mountId: 'enMediaCoachMount',
    });
  }

  function suggestEnSrsGrade(quality) {
    qsa('#enStickySrsFooter .en-srs-btn[data-quality]').forEach((b) => {
      b.classList.toggle('srs-suggested', Number(b.dataset.quality) === quality);
    });
  }

  function setEnMode(mode) {
    const prevMode = enState.currentMode;
    enState.currentMode = mode;
    qsa('#viewEnAtelier .en-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.enmode === mode);
    });
    $('enModeAnatomy')?.classList.toggle('hidden', mode !== 'anatomy');
    $('enModeCloze')?.classList.toggle('hidden', mode !== 'cloze');
    $('enModeSpelling')?.classList.toggle('hidden', mode !== 'spelling');
    $('enModeReference')?.classList.toggle('hidden', mode !== 'reference');
    $('enModeSquadron')?.classList.toggle('hidden', mode !== 'squadron');
    $('enStickySrsFooter')?.classList.toggle('hidden', mode === 'squadron');

    const workspaceEl = $('viewEnAtelier');
    if (workspaceEl) {
      workspaceEl.classList.toggle('squadron-active', mode === 'squadron');
    }
    $('enPromptStrip')?.classList.toggle('hidden', mode === 'squadron');

    if (mode === 'squadron') {
      window.MediaCoach?.pauseAll?.();
      syncViewTabs('enSquadron');
      initSquadronStage?.();
      setTimeout(() => $('sqTypeInput')?.focus(), 50);
    } else {
      if (prevMode === 'squadron') {
        pauseSquadronGame?.();
      }
      if (enState.currentView === 'enSquadron') {
        syncViewTabs('enAtelier');
      }
    }

    if (enState.currentWord && mode !== 'squadron') {
      renderPromptStrip(enState.currentWord);
    }
    if (mode === 'cloze') setTimeout(() => $('enClozeInput')?.focus(), 40);
    if (mode === 'spelling') setTimeout(() => $('enSpellingInput')?.focus(), 40);
  }

  async function navigateWord(delta) {
    if (!enState.filteredList.length || !enState.currentWord) return;
    const idx = enState.filteredList.findIndex((x) => x.w === enState.currentWord.w);
    const nextIdx = Math.max(0, Math.min(enState.filteredList.length - 1, (idx === -1 ? 0 : idx) + delta));
    while (nextIdx >= enState.renderedCount && enState.renderedCount < enState.filteredList.length) {
      renderWordList('append');
    }
    await selectWord(enState.filteredList[nextIdx]);
    document.querySelector('#enWordList .kanji-item.active')?.scrollIntoView({ block: 'nearest' });
  }

  // --- Interactive Checking (Cloze & Blind Spelling) ---
  function handleClozeSubmit(e) {
    e.preventDefault();
    const entry = enState.currentWord;
    if (!entry) return;
    const raw = ($('enClozeInput').value || '').trim().toLowerCase();
    const target = (enState._clozeTarget || entry.w).toLowerCase();
    const ok = raw.length > 0 && (raw === target || raw === entry.w.toLowerCase());

    const fb = $('enClozeFeedback');
    fb.classList.remove('hidden', 'ok', 'warn');
    const bridge = getBridge();
    bridge?.playWoodTap?.(ok);

    if (ok) {
      fb.classList.add('ok');
      fb.innerHTML = `<strong>Chính xác!</strong> ${escapeHtml(entry.exampleEn || entry.w)}`;
      const blank = $('enClozeSentence').querySelector('.en-cloze-blank');
      if (blank) blank.textContent = enState._clozeTarget || entry.w;
      speakEnglish(entry.w, 'en-US', 0.92);
      suggestEnSrsGrade(3);
    } else {
      fb.classList.add('warn');
      const diffObj = bridge?.buildCharDiffHtml ? bridge.buildCharDiffHtml(target, raw) : null;
      const diffHtml = diffObj ? diffObj.html : escapeHtml(target);
      fb.innerHTML = `Chưa khớp (đang gõ: <strong>${raw ? escapeHtml(raw) : 'trống'}</strong>). So sánh dự kiến: <span class="mono">${diffHtml}</span>`;
    }
  }

  function handleSpellingSubmit(e) {
    e.preventDefault();
    const entry = enState.currentWord;
    if (!entry) return;
    const actual = ($('enSpellingInput').value || '').trim().toLowerCase();
    const expected = entry.w.toLowerCase();
    const ok = actual === expected;

    const resEl = $('enSpellingResult');
    resEl.classList.remove('hidden', 'ok', 'warn');
    const bridge = getBridge();
    bridge?.playWoodTap?.(ok);

    if (ok) {
      $('enPromptWord').textContent = entry.w;
      $('enPromptWord').classList.remove('masked');
      $('enPromptEnDef').textContent = entry.enDef || '';
      resEl.classList.add('ok');
      resEl.innerHTML = `<strong>Chính xác tuyệt đối!</strong> ${escapeHtml(entry.w)} (${escapeHtml(entry.ipa)}) — ${escapeHtml(entry.vi)}`;

      const map = getEnProgressMap();
      const prev = getEnRecord(entry.w) || { reps: 0, interval: 0, ease: 2.5, writePasses: 0, blindPasses: 0, note: '' };
      prev.blindPasses = (prev.blindPasses || 0) + 1;
      map[entry.w] = prev;
      suggestEnSrsGrade(3);
      bridge?.saveProgress?.(true);
      updateWordListDots();
      speakEnglish(entry.w, 'en-US', 0.92);
    } else {
      resEl.classList.add('warn');
      const diffObj = bridge?.buildCharDiffHtml ? bridge.buildCharDiffHtml(expected, actual) : null;
      const diffHtml = diffObj ? `${diffObj.html} <span class="sub-hint">(${diffObj.accuracy}% khớp)</span>` : escapeHtml(expected);
      resEl.innerHTML = `Chưa khớp chính tả (${actual.length} / ${expected.length} ký tự): <div class="mono" style="margin-top:4px;font-size:15px;">${diffHtml}</div>`;
    }
  }

  async function recordEnglishSrs(quality) {
    const entry = enState.currentWord;
    const bridge = getBridge();
    if (!entry || !bridge?.applySrsGradeToRecord) return;

    const currIdx = enState.filteredList.findIndex((x) => x.w === entry.w);
    const map = getEnProgressMap();
    const prevRec = getEnRecord(entry.w);
    const wasNew = !prevRec || (!prevRec.reps && !prevRec.writePasses && !prevRec.blindPasses);

    map[entry.w] = bridge.applySrsGradeToRecord(prevRec, quality);

    const prog = bridge.getProgress ? bridge.getProgress() : null;
    const s = prog?.settings;

    if (enState.currentStatusFilter === 'today') {
      const todayStr = getLocalDateKey();
      if (s) {
        if (!s.enDailyNewLimit) s.enDailyNewLimit = 10;
        if (s.enDailyNewDate !== todayStr) {
          s.enDailyNewDate = todayStr;
          s.enDailyNewCount = 0;
        }
      }

      if (quality === 1) {
        enState.sessionFailedSet.add(entry.w);
      } else {
        enState.sessionFailedSet.delete(entry.w);
        if (wasNew && s) {
          s.enDailyNewCount = (s.enDailyNewCount || 0) + 1;
        }
      }

      bridge.saveProgress(true);
      bridge.updateDueBadges();
      updateTodayBadge();

      await applyFilterAndRender(false);

      if (enState.filteredList.length) {
        const nextIdx = Math.max(0, Math.min(currIdx === -1 ? 0 : currIdx, enState.filteredList.length - 1));
        while (nextIdx >= enState.renderedCount && enState.renderedCount < enState.filteredList.length) {
          renderWordList('append');
        }
        await selectWord(enState.filteredList[nextIdx]);
        if (enState.currentMode !== 'squadron' && enState.currentMode !== 'anatomy') {
          setEnMode('anatomy');
        }
      } else {
        enState.currentWord = null;
        renderWordList('reset');
        renderRightPanel(entry);
      }
      return;
    }

    bridge.saveProgress(true);
    bridge.updateDueBadges();

    if (enState.currentStatusFilter !== 'all') {
      await applyFilterAndRender(false);
      if (enState.filteredList.length) {
        const nextIdx = Math.max(0, Math.min(currIdx === -1 ? 0 : currIdx, enState.filteredList.length - 1));
        while (nextIdx >= enState.renderedCount && enState.renderedCount < enState.filteredList.length) {
          renderWordList('append');
        }
        await selectWord(enState.filteredList[nextIdx]);
        if (enState.currentMode !== 'squadron' && enState.currentMode !== 'anatomy') {
          setEnMode('anatomy');
        }
      } else {
        enState.currentWord = null;
        renderRightPanel(entry);
      }
    } else {
      updateWordListDots();
      renderRightPanel(entry);
      await navigateWord(1);
      if (enState.currentMode !== 'squadron' && enState.currentMode !== 'anatomy') {
        setEnMode('anatomy');
      }
    }
  }

  // --- Bind Events ---
  function bindEvents() {
    qsa('#enLevelTabs .en-level-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lvl = btn.dataset.enlevel;
        if (enState.currentView === 'enReader') {
          enReaderState.currentLevel = lvl;
          enState.currentLevel = lvl;
          syncLevelButtons();
          renderEnReaderList(true);
          return;
        }
        enState.currentLevel = lvl;
        enState.currentRootFilter = '';
        if ($('enRootFilterSelect')) $('enRootFilterSelect').value = '';
        if (enState.currentView !== 'enAtelier' && enState.currentView !== 'enSquadron' && enState.currentView !== 'enDue') {
          enState.currentStatusFilter = 'all';
          syncStatusChips();
          getBridge()?.switchAppSpace('en', 'enAtelier');
        }
        saveEnSessionState();
        applyFilterAndRender(true);
      });
    });

    qsa('#enViewTabs .en-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.enview;
        if (target === 'neuro') {
          getBridge()?.switchAppSpace('en', 'neuro');
        } else if (target === 'enSquadron') {
          getBridge()?.switchAppSpace('en', 'enSquadron');
        } else if (target === 'enReader') {
          getBridge()?.switchAppSpace('en', 'enReader');
        } else if (target === 'enDue') {
          enState.currentStatusFilter = 'due';
          syncStatusChips();
          saveEnSessionState();
          getBridge()?.switchAppSpace('en', 'enDue');
        } else {
          enState.currentStatusFilter = 'all';
          syncStatusChips();
          saveEnSessionState();
          getBridge()?.switchAppSpace('en', 'enAtelier');
        }
      });
    });

    $('enFilterDrawerToggle')?.addEventListener('click', () => {
      const drawer = $('enAdvancedFilterDrawer');
      const btn = $('enFilterDrawerToggle');
      if (!drawer || !btn) return;
      const isHidden = drawer.classList.toggle('hidden');
      btn.classList.toggle('active', !isHidden);
    });

    $('enToggleSidebarBtn')?.addEventListener('click', () => {
      const ws = $('viewEnAtelier');
      const btn = $('enToggleSidebarBtn');
      if (!ws || !btn) return;
      const collapsed = ws.classList.toggle('sidebar-collapsed');
      btn.textContent = collapsed ? '▶ Danh sách' : '◀ Danh sách';
    });

    $('enStepToClozeBtn')?.addEventListener('click', () => setEnMode('cloze'));
    $('enStepToSpellingBtn')?.addEventListener('click', () => setEnMode('spelling'));

    $('enSearchInput').addEventListener('input', (e) => {
      enState.searchQuery = e.target.value;
      applyFilterAndRender(true);
    });

    $('enGlobal10kToggle').addEventListener('change', (e) => {
      enState.global10k = e.target.checked;
      saveEnSessionState();
      applyFilterAndRender(true);
    });

    $('enRootFilterSelect').addEventListener('change', (e) => {
      enState.currentRootFilter = e.target.value;
      saveEnSessionState();
      applyFilterAndRender(true);
    });

    qsa('.en-filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        enState.currentStatusFilter = btn.dataset.enfilter;
        syncStatusChips();
        saveEnSessionState();
        applyFilterAndRender(true);
      });
    });

    $('enDailyLimitSelect')?.addEventListener('change', async (e) => {
      const s = getBridge()?.getProgress?.()?.settings;
      if (s) {
        s.enDailyNewLimit = Number(e.target.value) || 10;
        getBridge()?.saveProgress(true);
        updateTodayBadge();
      }
      await applyFilterAndRender(true);
    });

    $('enAddMoreNewBtn')?.addEventListener('click', async () => {
      const s = getBridge()?.getProgress?.()?.settings;
      if (s) {
        s.enDailyNewLimit = (s.enDailyNewLimit || 10) + 5;
        if ($('enDailyLimitSelect')) $('enDailyLimitSelect').value = String(s.enDailyNewLimit);
        getBridge()?.saveProgress(true);
        updateTodayBadge();
      }
      await applyFilterAndRender(true);
    });

    qsa('#viewEnAtelier .en-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setEnMode(btn.dataset.enmode));
    });

    $('enPrevWordBtn').addEventListener('click', () => navigateWord(-1));
    $('enNextWordBtn').addEventListener('click', () => navigateWord(1));

    $('enSpeakUsBtn').addEventListener('click', () => {
      if (enState.currentWord) speakEnglish(enState.currentWord.w, 'en-US', 0.92);
    });
    $('enSpeakUkBtn').addEventListener('click', () => {
      if (enState.currentWord) speakEnglish(enState.currentWord.w, 'en-GB', 0.92);
    });
    $('enYouglishBtn').addEventListener('click', () => {
      if (!enState.currentWord) return;
      window.MediaCoach?.openYouGlish(enState.currentWord.w, 'english', '', 'enMediaCoachMount');
    });
    $('enMicCheckBtn').addEventListener('click', () => {
      if (!enState.currentWord) return;
      window.MediaCoach?.openMicCoach({
        word: enState.currentWord.w,
        sentence: enState.currentWord.exampleEn || '',
        lang: 'en-US',
        mountId: 'enMediaCoachMount',
      });
    });
    $('enSpeakExampleBtn').addEventListener('click', () => {
      if (enState.currentWord?.exampleEn) speakEnglish(enState.currentWord.exampleEn, 'en-US', 0.94);
    });

    $('enClozeForm').addEventListener('submit', handleClozeSubmit);
    $('enClozeRevealBtn').addEventListener('click', () => {
      if (!enState.currentWord) return;
      const ans = enState._clozeTarget || enState.currentWord.w;
      $('enClozeInput').value = ans;
      const fb = $('enClozeFeedback');
      fb.classList.remove('hidden', 'warn');
      fb.classList.add('ok');
      fb.textContent = `Đáp án: ${ans} (${enState.currentWord.vi})`;
    });

    $('enSpellingListenBtn').addEventListener('click', () => {
      if (enState.currentWord) speakEnglish(enState.currentWord.w, 'en-US', 0.85);
    });
    $('enSpellingHintBtn').addEventListener('click', () => {
      const e = enState.currentWord;
      if (!e) return;
      const partsDesc = (e.parts || []).map((p) => `[${p.text} (${p.meaningVi})]`).join(' + ');
      const firstTwo = e.w.slice(0, Math.min(2, e.w.length));
      const box = $('enSpellingHintText');
      box.classList.remove('hidden');
      box.innerHTML = `Chữ cái đầu: <strong>${escapeHtml(firstTwo)}${'_'.repeat(Math.max(0, e.w.length - firstTwo.length))}</strong> (${e.w.length} chữ cái) · Cấu tạo: ${escapeHtml(partsDesc)}`;
    });
    $('enSpellingRevealBtn').addEventListener('click', () => {
      const e = enState.currentWord;
      if (!e) return;
      $('enPromptWord').textContent = e.w;
      $('enPromptWord').classList.remove('masked');
      $('enPromptEnDef').textContent = e.enDef || '';
      $('enSpellingInput').value = e.w;
      const resEl = $('enSpellingResult');
      resEl.classList.remove('hidden', 'warn');
      resEl.textContent = `Đáp án chuẩn: ${e.w} (${e.ipa})`;
    });
    $('enSpellingForm').addEventListener('submit', handleSpellingSubmit);

    $('enMnemonicInput').addEventListener('input', (e) => {
      if (!enState.currentWord) return;
      const w = enState.currentWord.w;
      const map = getEnProgressMap();
      const prev = getEnRecord(w) || { reps: 0, interval: 0, ease: 2.5, writePasses: 0, blindPasses: 0, note: '' };
      prev.note = e.target.value;
      map[w] = prev;
      $('enNoteSaveHint').textContent = 'Đang lưu...';
      clearTimeout(enState.noteTimer);
      enState.noteTimer = setTimeout(() => {
        getBridge()?.saveProgress?.(true);
        $('enNoteSaveHint').textContent = 'Đã lưu ổ đĩa';
      }, 450);
    });

    qsa('.en-srs-btn[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => recordEnglishSrs(Number(btn.dataset.quality)));
    });

    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const st = getBridge()?.getState?.();
      if (!st || st.currentSpace !== 'en') return;
      if (enState.currentView !== 'enAtelier' && enState.currentView !== 'enDue') return;
      if (enState.currentMode === 'squadron') return;
      if (!$('viewEnReader')?.classList.contains('hidden')) return;
      if ($('viewEnAtelier')?.classList.contains('hidden')) return;
      if (e.key === '[') navigateWord(-1);
      if (e.key === ']') navigateWord(1);
      if (['1', '2', '3', '4'].includes(e.key)) {
        recordEnglishSrs(Number(e.key));
      }
    });
  }

  // --- Shared Contextual YouGlish & Web Speech Mic Coach ---
  const ygState = {
    open: false,
    mountId: '',
    query: '',
    lang: 'english',
    accent: '',
    slow: false,
    playing: false,
    playerReady: false,
    pendingFetch: null,
    widget: null,
    apiPromise: null,
  };

  const micState = {
    open: false,
    word: '',
    sentence: '',
    reading: '',
    lang: 'en-US',
    listening: false,
    recognition: null,
  };

  function ensureCoachMounted(mountId) {
    const drawer = $('sharedMediaCoachDrawer');
    if (!drawer) return;
    const targetMount = $(mountId) || $('enMediaCoachMount');
    if (targetMount && drawer.parentElement !== targetMount) {
      targetMount.appendChild(drawer);
    }
    drawer.classList.remove('hidden');
  }

  function refreshDrawerVisibility() {
    const drawer = $('sharedMediaCoachDrawer');
    if (!drawer) return;
    const ygHidden = $('youglishDrawer')?.classList.contains('hidden');
    const micHidden = $('micCoachDrawer')?.classList.contains('hidden');
    drawer.classList.toggle('hidden', Boolean(ygHidden && micHidden));
  }

  function loadYouglishApi() {
    if (window.YG && typeof window.YG.Widget === 'function') {
      return Promise.resolve({ ok: true });
    }
    if (ygState.apiPromise) return ygState.apiPromise;

    ygState.apiPromise = new Promise((resolve) => {
      let settled = false;
      const done = (res) => {
        if (!settled) {
          settled = true;
          resolve(res);
        }
      };

      const prevReady = window.onYouglishAPIReady;
      window.onYouglishAPIReady = () => {
        if (typeof prevReady === 'function') prevReady();
        done({ ok: true });
      };

      const script = document.createElement('script');
      script.src = 'https://youglish.com/public/emb/widget.js';
      script.async = true;
      script.charset = 'utf-8';
      script.onload = () => {
        if (window.YG && typeof window.YG.Widget === 'function') {
          done({ ok: true });
        }
      };
      script.onerror = () => {
        ygState.apiPromise = null;
        done({ ok: false, reason: 'network_error' });
      };
      document.head.appendChild(script);

      setTimeout(() => {
        if (!settled) {
          ygState.apiPromise = null;
          done({ ok: false, reason: 'timeout' });
        }
      }, 7500);
    });

    return ygState.apiPromise;
  }

  function normalizeSpeechText(str, lang) {
    const clean = String(str || '').toLowerCase().trim();
    if (lang === 'ja-JP') {
      return clean.replace(/[\s。、「」『』？！!?.,・]/g, '');
    }
    return clean.replace(/[.,!?;:'"()\-—]/g, '').replace(/\s+/g, ' ').trim();
  }

  function updateMicTargetDisplay() {
    const modeSel = $('micTargetModeSelect');
    const box = $('micTargetText');
    const resBox = $('micResultBox');
    if (!modeSel || !box) return;
    const hasSentence = Boolean(micState.sentence);
    const sentOpt = modeSel.querySelector('option[value="sentence"]');
    if (sentOpt) sentOpt.disabled = !hasSentence;
    if (!hasSentence && modeSel.value === 'sentence') modeSel.value = 'word';

    const target = modeSel.value === 'sentence' && hasSentence ? micState.sentence : micState.word;
    box.textContent = micState.reading && modeSel.value === 'word'
      ? `${target}  (${micState.reading})`
      : target;
    if (resBox) {
      resBox.classList.add('hidden');
      resBox.classList.remove('ok', 'warn');
    }
  }

  function stopMicRecognition() {
    if (micState.recognition) {
      try {
        micState.recognition.onresult = null;
        micState.recognition.onerror = null;
        micState.recognition.onend = null;
        micState.recognition.stop();
      } catch (_) {}
      micState.recognition = null;
    }
    micState.listening = false;
    const btn = $('micStartStopBtn');
    if (btn) {
      btn.classList.remove('listening');
      btn.textContent = '🎙️ Bấm để nói';
    }
  }

  function bindMediaCoachEvents() {
    $('ygCloseBtn').addEventListener('click', () => {
      ygState.open = false;
      ygState.widget?.pause?.();
      $('youglishDrawer').classList.add('hidden');
      refreshDrawerVisibility();
    });

    qsa('#ygAccentGroup .yg-accent-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!ygState.query || ygState.lang !== 'english') return;
        window.MediaCoach.openYouGlish(ygState.query, 'english', btn.dataset.ygaccent, ygState.mountId);
      });
    });

    $('ygPrevBtn').addEventListener('click', () => ygState.widget?.previous?.());
    $('ygNextBtn').addEventListener('click', () => ygState.widget?.next?.());
    $('ygReplayBtn').addEventListener('click', () => {
      const w = ygState.widget;
      if (!w) return;
      if (typeof w.replay === 'function') {
        w.replay();
      } else {
        w.seekTo?.(0);
        w.play?.();
      }
    });
    $('ygPlayPauseBtn').addEventListener('click', () => {
      const w = ygState.widget;
      if (!w) return;
      if (ygState.playing) {
        w.pause?.();
        ygState.playing = false;
      } else {
        w.play?.();
        ygState.playing = true;
      }
    });
    $('ygSlowBtn').addEventListener('click', () => {
      ygState.slow = !ygState.slow;
      const rate = ygState.slow ? 0.75 : 1.0;
      const w = ygState.widget;
      if (w) (w.setSpeed || w.speed)?.call(w, rate);
      $('ygSlowBtn').textContent = ygState.slow ? '⚡ 1.0x' : '🐢 0.75x';
    });

    $('micTargetModeSelect').addEventListener('change', updateMicTargetDisplay);
    $('micCloseBtn').addEventListener('click', () => {
      micState.open = false;
      stopMicRecognition();
      $('micCoachDrawer').classList.add('hidden');
      refreshDrawerVisibility();
    });

    $('micStartStopBtn').addEventListener('click', () => {
      if (micState.listening) {
        stopMicRecognition();
        return;
      }
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      const resBox = $('micResultBox');
      if (!Rec) {
        resBox.classList.remove('hidden', 'ok');
        resBox.classList.add('warn');
        resBox.textContent = 'Trình duyệt này chưa hỗ trợ Web Speech Recognition (hãy dùng Chrome / Edge để chấm phát âm bằng Mic).';
        return;
      }

      window.speechSynthesis?.cancel?.();
      const rec = new Rec();
      rec.lang = micState.lang || 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 3;
      micState.recognition = rec;
      micState.listening = true;

      $('micStartStopBtn').classList.add('listening');
      $('micStartStopBtn').textContent = '⏹ Đang nghe... (nói ngay)';
      resBox.classList.remove('hidden', 'ok', 'warn');
      resBox.textContent = 'Hãy đọc to mẫu chữ bên trên...';

      rec.onresult = (evt) => {
        const mode = $('micTargetModeSelect').value;
        const expectedRaw = mode === 'sentence' && micState.sentence ? micState.sentence : micState.word;
        const expectedNorm = normalizeSpeechText(expectedRaw, micState.lang);
        const readingNorm = micState.reading ? normalizeSpeechText(micState.reading, micState.lang) : '';

        const alts = Array.from(evt.results[0] || []).map((r) => String(r.transcript || '').trim()).filter(Boolean);
        const spokenRaw = alts[0] || '';
        const bridge = getBridge();

        let best = { html: escapeHtml(expectedNorm), accuracy: 0 };
        let bestSpoken = spokenRaw;
        for (const cand of alts) {
          const normCand = normalizeSpeechText(cand, micState.lang);
          const diffMain = bridge?.buildCharDiffHtml ? bridge.buildCharDiffHtml(expectedNorm, normCand) : { html: escapeHtml(normCand), accuracy: expectedNorm === normCand ? 100 : 0 };
          let scoreObj = diffMain;
          if (readingNorm && bridge?.buildCharDiffHtml) {
            const diffRead = bridge.buildCharDiffHtml(readingNorm, normCand);
            if (diffRead.accuracy > scoreObj.accuracy) scoreObj = diffRead;
          }
          if (scoreObj.accuracy >= best.accuracy) {
            best = scoreObj;
            bestSpoken = cand;
          }
        }

        const passed = best.accuracy >= 80;
        bridge?.playWoodTap?.(passed);
        resBox.classList.remove('hidden', 'ok', 'warn');
        resBox.classList.add(passed ? 'ok' : 'warn');
        resBox.innerHTML = `
          <div>Máy nghe được: <strong>"${escapeHtml(bestSpoken || '—')}"</strong> · Độ khớp: <strong>${best.accuracy}%</strong></div>
          <div class="mono" style="margin-top:4px;font-size:14.5px;">${best.html}</div>
        `;
      };

      rec.onerror = (evt) => {
        resBox.classList.remove('hidden', 'ok');
        resBox.classList.add('warn');
        const msgMap = {
          'not-allowed': 'Trình duyệt chưa được cấp quyền Microphone.',
          'no-speech': 'Không nghe thấy giọng nói. Hãy bấm thử lại gần mic hơn.',
          'audio-capture': 'Không tìm thấy thiết bị Microphone.',
        };
        resBox.textContent = msgMap[evt.error] || `Lỗi nhận diện giọng nói (${evt.error || 'unknown'}).`;
      };

      rec.onend = () => {
        stopMicRecognition();
      };

      try {
        rec.start();
      } catch (_) {
        stopMicRecognition();
      }
    });
  }

  window.MediaCoach = {
    openYouGlish: async (query, lang = 'english', accent = '', mountId) => {
      if (!query) return;
      const targetMount = mountId || (getBridge()?.getState()?.currentSpace === 'jp' ? 'jpMediaCoachMount' : 'enMediaCoachMount');
      ensureCoachMounted(targetMount);
      $('youglishDrawer').classList.remove('hidden');

      ygState.open = true;
      ygState.mountId = targetMount;
      ygState.query = query;
      ygState.lang = lang;
      ygState.accent = lang === 'english' ? accent : '';
      ygState.slow = false;
      $('ygSlowBtn').textContent = '🐢 0.75x';

      $('ygCurrentQueryLabel').textContent = lang === 'japanese' ? `🎬 YouGlish JP: ${query}` : `🎬 YouGlish: ${query}`;
      $('ygAccentGroup').classList.toggle('hidden', lang !== 'english');
      qsa('#ygAccentGroup .yg-accent-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.ygaccent === ygState.accent);
      });

      const extPath = lang === 'english' && ygState.accent
        ? `https://youglish.com/pronounce/${encodeURIComponent(query)}/english/${ygState.accent}`
        : `https://youglish.com/pronounce/${encodeURIComponent(query)}/${lang}`;
      $('ygExternalLink').href = extPath;
      $('ygStatusHint').textContent = 'Đang nạp trình phát YouGlish (chế độ tối giản chống xao nhãng)...';

      const loadRes = await loadYouglishApi();
      if (!loadRes.ok || !window.YG || typeof window.YG.Widget !== 'function') {
        $('ygStatusHint').textContent = 'Không tải được YouGlish nhúng (mất mạng hoặc bị chặn). Hãy bấm "Mở YouGlish ↗" ở góc phải để nghe trực tiếp.';
        return;
      }

      const runFetch = () => {
        if (!ygState.widget) return;
        ygState.playing = true;
        if (lang === 'english' && ygState.accent) {
          ygState.widget.fetch(query, lang, ygState.accent);
        } else {
          ygState.widget.fetch(query, lang);
        }
      };

      if (!ygState.widget) {
        ygState.pendingFetch = runFetch;
        const wrapW = Math.max(580, Math.min(720, ($('ygWidgetWrap')?.clientWidth || 640) - 16));
        ygState.widget = new window.YG.Widget('yg-widget-0', {
          width: wrapW,
          components: 72,
          events: {
            onPlayerReady: () => {
              ygState.playerReady = true;
              if (typeof ygState.pendingFetch === 'function') {
                const fn = ygState.pendingFetch;
                ygState.pendingFetch = null;
                fn();
              }
            },
            onFetchDone: (e) => {
              const total = e?.totalResult ?? e?.total ?? 0;
              $('ygStatusHint').textContent = total > 0
                ? `Tìm thấy ${total.toLocaleString('vi-VN')} câu nói thực tế. Dùng thanh nút bên trên để tua / làm chậm.`
                : `Chưa có clip khớp cho "${ygState.query}". Hãy thử bỏ bộ lọc giọng hoặc mở link YouGlish ↗.`;
            },
            onVideoChange: (e) => {
              ygState.playing = true;
              const num = e?.trackNumber;
              if (num) {
                $('ygStatusHint').textContent = `Đang phát ví dụ thực tế #${num} cho "${ygState.query}".`;
              }
            },
            onStateChange: (e) => {
              // YG uses YT states: 1=playing, 2=paused
              if (e?.state === 2) ygState.playing = false;
              else if (e?.state === 1) ygState.playing = true;
            },
            onError: () => {
              $('ygStatusHint').textContent = 'YouGlish tạm phản hồi lỗi — bạn có thể bấm "Mở YouGlish ↗" để nghe trực tiếp.';
            },
          },
        });
        runFetch();
      } else {
        runFetch();
      }
    },

    openMicCoach: ({ word, sentence = '', reading = '', lang = 'en-US', mountId }) => {
      if (!word) return;
      const targetMount = mountId || (getBridge()?.getState()?.currentSpace === 'jp' ? 'jpMediaCoachMount' : 'enMediaCoachMount');
      ensureCoachMounted(targetMount);
      $('micCoachDrawer').classList.remove('hidden');

      micState.open = true;
      micState.word = word;
      micState.sentence = sentence;
      micState.reading = reading;
      micState.lang = lang;
      stopMicRecognition();
      updateMicTargetDisplay();
    },

    syncTarget: ({ word, sentence = '', reading = '', lang = 'en-US', mountId }) => {
      if (!micState.open) return;
      micState.word = word;
      micState.sentence = sentence;
      micState.reading = reading;
      micState.lang = lang;
      stopMicRecognition();
      ensureCoachMounted(mountId);
      updateMicTargetDisplay();
    },

    pauseAll: () => {
      ygState.open = false;
      ygState.mountId = '';
      ygState.widget?.pause?.();
      ygState.playing = false;
      micState.open = false;
      stopMicRecognition();
      const drawer = $('sharedMediaCoachDrawer');
      const homeMount = $('enMediaCoachMount');
      if (drawer && homeMount && drawer.parentElement !== homeMount) {
        homeMount.appendChild(drawer);
      }
      $('youglishDrawer')?.classList.add('hidden');
      $('micCoachDrawer')?.classList.add('hidden');
      refreshDrawerVisibility();
    },
  };

  // --- MODE 4: FALLING SQUADRON ACTIVE RECALL ("NẠP NGUYÊN TỪ & KHAI HỎA") ---
  const SQ_W = 920;
  const SQ_H = 480;
  const ROOT_PALETTE = [
    '#5BA4C8',
    '#52B788',
    '#DDA15E',
    '#E5624F',
    '#A78BFA',
    '#38BDF8',
    '#F472B6',
    '#FBBF24',
  ];

  const sqState = {
    initialized: false,
    running: false,
    paused: false,
    finished: false,
    rafId: null,
    lastTs: 0,
    elapsed: 0,
    wave: 1,
    maxWaves: 5,
    wavePendingSpawn: false,
    waveDelayTimer: 0,
    bossEscortTimer: 0,
    nextAudioTimer: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    misses: 0,
    shields: 5,
    maxShields: 5,
    empCharge: 0,
    focusedId: null,
    nextEnemyId: 1,
    turretAngle: -Math.PI / 2,
    muzzleFlash: 0,
    muzzleError: 0,
    radarPulse: 0,
    sessionRecallEligible: true,
    usingFallbackDeck: false,
    draftText: '',
    feedbackMsg: '',
    feedbackKind: '',
    feedbackTimer: 0,
    shockwaves: [],
    enemies: [],
    projectiles: [],
    particles: [],
    lightnings: [],
    floatingTexts: [],
    consolidations: [],
    stars: [],
    deckPool: null,
    cleanKills: new Map(), // key -> { w, vi, rootId, rootMeaningVi }
    missedWords: new Map(), // key -> { w, vi, rootId, rootMeaningVi }
  };

  function hashRootColor(rootId) {
    if (!rootId) return '#8B9CB6';
    let h = 0;
    for (let i = 0; i < rootId.length; i++) {
      h = (h * 31 + rootId.charCodeAt(i)) >>> 0;
    }
    return ROOT_PALETTE[h % ROOT_PALETTE.length];
  }

  function shuffleArr(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function cleanViShort(vi, maxLen = 46) {
    if (!vi) return 'từ vựng Tiếng Anh';
    const clean = String(vi).replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? `${clean.slice(0, maxLen - 2)}…` : clean;
  }

  function getRootMeaningVi(rootId) {
    if (!rootId) return '';
    const r = enState.rootsById[rootId];
    if (!r || !r.meaningVi) return '';
    return String(r.meaningVi).split(',')[0].trim();
  }

  function getPosShort(pos) {
    const p = String(pos || '').trim().toLowerCase();
    if (!p || p === 'word' || p === 'corpus 10k') return '';
    const map = {
      noun: 'n',
      verb: 'v',
      adjective: 'adj',
      adverb: 'adv',
      preposition: 'prep',
      conjunction: 'conj',
      pronoun: 'pron',
    };
    for (const [k, v] of Object.entries(map)) {
      if (p.startsWith(k)) return v;
    }
    return p.slice(0, 5);
  }

  function sanitizeClueText(text, targetWords) {
    let out = String(text || '');
    const words = (Array.isArray(targetWords) ? targetWords : [targetWords])
      .map((w) => String(w || '').trim().toLowerCase())
      .filter((w) => w.length >= 4);
    for (const w of words) {
      const rx = new RegExp(`(?<![A-Za-zÀ-ỹ])${escapeRegex(w)}(?![A-Za-zÀ-ỹ])`, 'gi');
      out = out.replace(rx, '___');
    }
    return out;
  }

  function buildMorphMeaningVi(entry) {
    if (!entry || !Array.isArray(entry.parts) || !entry.parts.length) return '';
    const pieces = entry.parts
      .map((p) => String(p.meaningVi || '').split(',')[0].trim())
      .filter((s) => s && !/gốc từ nguyên khối|nguyên khối/i.test(s));
    if (!pieces.length) return '';
    return pieces.map((s) => `[${s}]`).join(' + ');
  }

  function buildMorphLatinFormula(entry) {
    if (!entry || !Array.isArray(entry.parts) || !entry.parts.length) return '';
    if (entry.parts.length === 1 && (entry.parts[0].text || '').toLowerCase() === (entry.w || '').toLowerCase()) {
      return '';
    }
    return entry.parts.map((p) => p.text).join(' + ');
  }

  function isRichSquadronEntry(entry) {
    if (!entry || !entry.w) return false;
    const vi = String(entry.vi || '').trim();
    if (!vi || /Đang tra (cứu )?nghĩa Tiếng Việt|từ thông dụng|Chưa có nghĩa trực tuyến|Không kết nối được/i.test(vi)) {
      return false;
    }
    return true;
  }

  function buildClozeFromText(fullText, baseWord) {
    const cleanFull = String(fullText || '').replace(/\s+/g, ' ').trim();
    const w = String(baseWord || '').trim().toLowerCase();
    if (!cleanFull || !w) {
      return { clozeText: cleanFull, matchedForm: w, acceptedAnswers: w ? [w] : [], matched: false };
    }

    const candidates = [escapeRegex(w)];
    if (w.endsWith('y') && w.length > 2) {
      const stemY = escapeRegex(w.slice(0, -1));
      candidates.push(`${stemY}(?:y|ies|ied|ier|iest|ily|ying|ication|ications)`);
    } else if (w.endsWith('e') && w.length > 2) {
      const stemE = escapeRegex(w.slice(0, -1));
      candidates.push(`${stemE}(?:e|es|ed|ing|er|ers|ion|ions|ive|ication|ications)`);
    }
    candidates.push(`${escapeRegex(w)}(?:s|es|ed|d|ing|er|ers|est|ly|al|ally|tion|sion|ment|ive|ity)?`);

    const exactPattern = new RegExp(`\\b(${candidates.join('|')})\\b`, 'i');
    let m = cleanFull.match(exactPattern);
    if (!m && w.length >= 4) {
      const stem4 = escapeRegex(w.slice(0, w.length - 1));
      const fuzzyPattern = new RegExp(`\\b(${stem4}[a-z]{0,8})\\b`, 'i');
      m = cleanFull.match(fuzzyPattern);
    }

    if (!m) {
      return { clozeText: cleanFull, matchedForm: w, acceptedAnswers: [w], matched: false };
    }

    const matchedForm = m[1];
    const matchIdx = m.index;
    const clozeText = `${cleanFull.slice(0, matchIdx)}_______${cleanFull.slice(matchIdx + matchedForm.length)}`;
    const accepted = new Set([w, matchedForm.toLowerCase()]);
    return {
      clozeText,
      matchedForm,
      acceptedAnswers: Array.from(accepted),
      matched: true,
    };
  }

  function makeSingleWordItem(entry) {
    if (!isRichSquadronEntry(entry)) return null;
    const wClean = String(entry.w).trim();
    if (!wClean || wClean.length < 2) return null;
    const rootVi = sanitizeClueText(getRootMeaningVi(entry.rootId), wClean);
    const morphVi = sanitizeClueText(buildMorphMeaningVi(entry), wClean);
    const hasMultiParts = Array.isArray(entry.parts) && entry.parts.length >= 2 && Boolean(morphVi);
    return {
      kind: 'word',
      isCloze: false,
      key: wClean.toLowerCase(),
      answerWord: wClean,
      acceptedAnswers: [wClean.toLowerCase()],
      audioText: wClean,
      displayCloze: '',
      fullText: wClean,
      matchedForm: wClean,
      vi: cleanViShort(sanitizeClueText(entry.vi, wClean), 44),
      posShort: getPosShort(entry.pos),
      ipa: entry.ipa || '',
      rootId: entry.rootId || '',
      rootMeaningVi: rootVi,
      morphVi,
      morphLatin: buildMorphLatinFormula(entry),
      hasMultiParts,
      lvl: entry.lvl || 'A1',
      answerLen: wClean.length,
    };
  }

  function makePhraseItem(phrase, vi, parentEntry) {
    if (!parentEntry || !parentEntry.w) return null;
    const cleanText = String(phrase || '').replace(/\s+/g, ' ').trim();
    if (!cleanText || cleanText.length < 4) return null;
    const cloze = buildClozeFromText(cleanText, parentEntry.w);
    if (!cloze.matched) return null;

    const accepted = new Set(cloze.acceptedAnswers);
    const cleanFullLower = cleanText.replace(/[.!?]+$/, '').trim().toLowerCase();
    if (cleanFullLower) accepted.add(cleanFullLower);

    const wClean = parentEntry.w;
    return {
      kind: 'phrase',
      isCloze: true,
      key: wClean.toLowerCase(),
      answerWord: wClean,
      acceptedAnswers: Array.from(accepted),
      audioText: cleanText,
      displayCloze: cloze.clozeText,
      fullText: cleanText,
      matchedForm: cloze.matchedForm,
      vi: cleanViShort(sanitizeClueText(vi || parentEntry.vi || '', acceptedAnswersArray(accepted, wClean)), 52),
      posShort: getPosShort(parentEntry.pos),
      ipa: parentEntry.ipa || '',
      rootId: parentEntry.rootId || '',
      rootMeaningVi: sanitizeClueText(getRootMeaningVi(parentEntry.rootId), wClean),
      morphVi: sanitizeClueText(buildMorphMeaningVi(parentEntry), wClean),
      morphLatin: buildMorphLatinFormula(parentEntry),
      hasMultiParts: Array.isArray(parentEntry.parts) && parentEntry.parts.length >= 2,
      lvl: parentEntry.lvl || 'A1',
      answerLen: cloze.matchedForm.length,
    };
  }

  function acceptedAnswersArray(setObj, fallbackWord) {
    return Array.from(setObj || [fallbackWord]).filter((x) => !x.includes(' '));
  }

  function makeSentenceItem(entry) {
    if (!entry || !entry.w || !entry.exampleEn) return null;
    const cleanSent = String(entry.exampleEn).replace(/\s+/g, ' ').trim();
    if (!cleanSent || cleanSent.length < 10) return null;
    const cloze = buildClozeFromText(cleanSent, entry.w);
    if (!cloze.matched) return null;

    const wClean = entry.w;
    return {
      kind: 'sentence',
      isCloze: true,
      key: wClean.toLowerCase(),
      answerWord: wClean,
      acceptedAnswers: cloze.acceptedAnswers,
      audioText: cleanSent,
      displayCloze: cloze.clozeText,
      fullText: cleanSent,
      matchedForm: cloze.matchedForm,
      vi: cleanViShort(sanitizeClueText(entry.exampleVi || entry.vi, cloze.acceptedAnswers), 72),
      posShort: getPosShort(entry.pos),
      ipa: entry.ipa || '',
      rootId: entry.rootId || '',
      rootMeaningVi: sanitizeClueText(getRootMeaningVi(entry.rootId), wClean),
      morphVi: sanitizeClueText(buildMorphMeaningVi(entry), wClean),
      morphLatin: buildMorphLatinFormula(entry),
      hasMultiParts: Array.isArray(entry.parts) && entry.parts.length >= 2,
      lvl: entry.lvl || 'A1',
      answerLen: cloze.matchedForm.length,
    };
  }

  function resolveLearnedRichEntries() {
    const progressMap = getEnProgressMap();
    const keys = Object.keys(progressMap);
    // Prioritize due words first, then remaining learned words
    keys.sort((a, b) => {
      const da = getWordStatus(a) === 'due' ? 0 : 1;
      const db = getWordStatus(b) === 'due' ? 0 : 1;
      return da - db;
    });

    const resolved = [];
    for (const w of keys) {
      const cur = enState.vocabByWord[w];
      if (isRichSquadronEntry(cur)) {
        resolved.push(cur);
        continue;
      }
      const rec = progressMap[w];
      const stub = makeEntryFromRecord(w, rec);
      if (isRichSquadronEntry(stub)) {
        resolved.push(stub);
      }
    }
    return resolved;
  }

  function buildSquadronDeck() {
    const mode = $('sqDeckSelect')?.value || 'learned_today';
    const learnedEntries = resolveLearnedRichEntries();
    const curated = (enState.vocab || []).filter(isRichSquadronEntry);
    const sameLevelCurated = curated.filter((c) => c.lvl === enState.currentLevel);

    sqState.usingFallbackDeck = false;
    let wordsPool = [];
    let richSource = [];

    if (mode === 'learned_today') {
      if (learnedEntries.length > 0) {
        richSource = learnedEntries;
      } else {
        sqState.usingFallbackDeck = true;
        richSource = (sameLevelCurated.length ? sameLevelCurated : curated).slice(0, 12);
      }
      const seen = new Set();
      richSource.forEach((e) => {
        const it = makeSingleWordItem(e);
        if (it && !seen.has(it.key)) {
          seen.add(it.key);
          wordsPool.push(it);
        }
      });
    } else if (mode === 'filtered') {
      const filteredRich = (enState.filteredList || []).filter(isRichSquadronEntry);
      richSource = filteredRich.length ? filteredRich : (sameLevelCurated.length ? sameLevelCurated : curated);
      const seen = new Set();
      richSource.slice(0, 50).forEach((e) => {
        const it = makeSingleWordItem(e);
        if (it && !seen.has(it.key)) {
          seen.add(it.key);
          wordsPool.push(it);
        }
      });
    } else {
      // mixed_campaign | collocations | sentences: learned + current CEFR level only (no cross-level leakage)
      richSource = [...learnedEntries, ...(sameLevelCurated.length ? sameLevelCurated : curated)];
      const seen = new Set();
      richSource.forEach((e) => {
        const it = makeSingleWordItem(e);
        if (it && !seen.has(it.key)) {
          seen.add(it.key);
          wordsPool.push(it);
        }
      });
    }

    const phrasesPool = [];
    const sentencesPool = [];
    const seenPhrase = new Set();
    const seenSent = new Set();
    richSource.forEach((e) => {
      if (Array.isArray(e.collocations)) {
        e.collocations.forEach((col) => {
          const item = makePhraseItem(col.phrase, col.vi, e);
          if (item && !seenPhrase.has(item.fullText.toLowerCase())) {
            seenPhrase.add(item.fullText.toLowerCase());
            phrasesPool.push(item);
          }
        });
      }
      const sent = makeSentenceItem(e);
      if (sent && !seenSent.has(sent.fullText.toLowerCase())) {
        seenSent.add(sent.fullText.toLowerCase());
        sentencesPool.push(sent);
      }
    });

    if (mode === 'collocations') {
      wordsPool = phrasesPool.length ? shuffleArr(phrasesPool) : shuffleArr(wordsPool);
    } else if (mode === 'sentences') {
      wordsPool = sentencesPool.length ? shuffleArr(sentencesPool) : (phrasesPool.length ? shuffleArr(phrasesPool) : shuffleArr(wordsPool));
    } else {
      wordsPool = wordsPool.length ? shuffleArr(wordsPool) : curated.slice(0, 12).map(makeSingleWordItem).filter(Boolean);
    }

    return {
      mode,
      words: wordsPool,
      phrases: shuffleArr(phrasesPool),
      sentences: shuffleArr(sentencesPool),
      wordCursor: 0,
      phraseCursor: 0,
      sentCursor: 0,
    };
  }

  function pickNextWordItem() {
    if (!sqState.deckPool || !sqState.deckPool.words?.length) return null;
    const pool = sqState.deckPool.words;
    const item = pool[sqState.deckPool.wordCursor % pool.length];
    sqState.deckPool.wordCursor += 1;
    if (sqState.deckPool.wordCursor % pool.length === 0) {
      sqState.deckPool.words = shuffleArr(pool);
    }
    return item;
  }

  function pickNextPhraseItem() {
    const phrases = sqState.deckPool?.phrases;
    if (phrases && phrases.length) {
      const item = phrases[sqState.deckPool.phraseCursor % phrases.length];
      sqState.deckPool.phraseCursor += 1;
      return item;
    }
    return pickNextWordItem();
  }

  function pickNextSentenceItem() {
    const sents = sqState.deckPool?.sentences;
    if (sents && sents.length) {
      const item = sents[sqState.deckPool.sentCursor % sents.length];
      sqState.deckPool.sentCursor += 1;
      return item;
    }
    return pickNextPhraseItem();
  }

  function buildBossArmorStages(deckMode) {
    const stages = [];
    const seenTexts = new Set();
    const usedKeys = new Set();

    const tryPush = (cand, allowSameKey = false) => {
      if (!cand) return false;
      const sig = (cand.displayCloze || cand.answerWord).toLowerCase();
      if (seenTexts.has(sig)) return false;
      if (!allowSameKey && usedKeys.has(cand.key)) return false;
      seenTexts.add(sig);
      usedKeys.add(cand.key);
      stages.push(cand);
      return true;
    };

    const sents = sqState.deckPool?.sentences || [];
    const phrases = sqState.deckPool?.phrases || [];
    const words = sqState.deckPool?.words || [];
    const primaryPool = deckMode === 'collocations' ? phrases : sents;

    for (const item of primaryPool) {
      if (stages.length >= 3) break;
      tryPush(item, false);
    }
    if (stages.length < 3) {
      for (const item of phrases) {
        if (stages.length >= 3) break;
        tryPush(item, false);
      }
    }
    if (stages.length < 3) {
      for (const item of words) {
        if (stages.length >= 3) break;
        tryPush(item, false);
      }
    }
    // If deck had fewer than 3 distinct words total, fill remaining Boss armor layers cleanly
    const fallbackCombined = [...primaryPool, ...phrases, ...words];
    for (const item of fallbackCombined) {
      if (stages.length >= 3) break;
      tryPush(item, true);
    }
    return stages;
  }

  function pickRootClusterWords(count) {
    const pool = sqState.deckPool?.words || [];
    const byRoot = Object.create(null);
    pool.forEach((it) => {
      if (it.rootId) {
        if (!byRoot[it.rootId]) byRoot[it.rootId] = [];
        byRoot[it.rootId].push(it);
      }
    });
    const clusters = Object.values(byRoot).filter((g) => g.length >= 2);
    const chosen = [];
    const usedKeys = new Set();
    if (clusters.length) {
      const grp = clusters[Math.floor(Math.random() * clusters.length)];
      grp.slice(0, Math.min(3, count)).forEach((g) => {
        if (!usedKeys.has(g.key)) {
          usedKeys.add(g.key);
          chosen.push(g);
        }
      });
    }
    let guard = 0;
    while (chosen.length < count && guard < 20) {
      guard += 1;
      const next = pickNextWordItem();
      if (!next) break;
      if (!usedKeys.has(next.key) || guard >= pool.length) {
        usedKeys.add(next.key);
        chosen.push(next);
      }
    }
    return chosen;
  }

  function getSpeedMultiplier() {
    const val = $('sqSpeedSelect')?.value || 'normal';
    if (val === 'calm') return 0.65;
    if (val === 'intense') return 1.38;
    return 1.0;
  }

  function getEnemyStage(enemy) {
    if (!enemy) return null;
    if (Array.isArray(enemy.armorStages) && enemy.armorStages.length) {
      return enemy.armorStages[Math.min(enemy.armorIdx || 0, enemy.armorStages.length - 1)] || enemy.armorStages[0];
    }
    return enemy;
  }

  function createEnemyFromItem(item, { x, y, vy, swayAmp = 12, swayFreq = 1.2, phase = 0, isElite = false, isBoss = false, armorStages = null }) {
    const primary = Array.isArray(armorStages) && armorStages.length ? armorStages[0] : item;
    return {
      id: sqState.nextEnemyId++,
      kind: primary.kind || 'word',
      isCloze: Boolean(primary.isCloze),
      key: primary.key,
      answerWord: primary.answerWord,
      acceptedAnswers: primary.acceptedAnswers,
      audioText: primary.audioText || primary.answerWord,
      displayCloze: primary.displayCloze || '',
      fullText: primary.fullText || primary.answerWord,
      matchedForm: primary.matchedForm || primary.answerWord,
      vi: primary.vi || '',
      posShort: primary.posShort || '',
      ipa: primary.ipa || '',
      rootId: primary.rootId || '',
      rootMeaningVi: primary.rootMeaningVi || '',
      morphVi: primary.morphVi || '',
      morphLatin: primary.morphLatin || '',
      hasMultiParts: Boolean(primary.hasMultiParts),
      lvl: primary.lvl || 'A1',
      answerLen: primary.answerLen || primary.answerWord.length,
      armorStages: Array.isArray(armorStages) && armorStages.length ? armorStages : null,
      armorIdx: 0,
      isElite: isElite || primary.kind === 'phrase',
      isBoss: Boolean(isBoss),
      color: hashRootColor(primary.rootId),
      baseX: x,
      x,
      y,
      vy,
      swayAmp,
      swayFreq,
      phase,
      radarLevel: 0, // 0: hidden, 1: IPA + morph Vietnamese + audio, 2: full reveal
      revealed: false,
      usedRadar: false,
      hitFlash: 0,
      freezeTimer: 0,
      slowTimer: 0,
      _rect: null,
    };
  }

  function pickActiveAudioTarget() {
    if (!sqState.enemies.length) return null;
    const focused = sqState.enemies.find((e) => e.id === sqState.focusedId);
    if (focused) return focused;
    return sqState.enemies.slice().sort((a, b) => b.y - a.y)[0] || null;
  }

  function speakActiveAudioTarget(rate = 0.92) {
    const target = pickActiveAudioTarget();
    if (!target) return null;
    const stage = getEnemyStage(target);
    if (stage) speakEnglish(stage.audioText || stage.answerWord, 'en-US', rate);
    return target;
  }

  function spawnSquadronWave(waveNum) {
    sqState.wave = waveNum;
    sqState.wavePendingSpawn = false;
    sqState.nextAudioTimer = 0;
    const spMult = getSpeedMultiplier();
    const recallMode = $('sqRecallSelect')?.value || 'blind_meaning';
    const deckMode = $('sqDeckSelect')?.value || 'learned_today';
    const isLongDeck = deckMode === 'collocations' || deckMode === 'sentences';
    const baseVy = (isLongDeck ? 11.5 : 15) * spMult * (1 + (waveNum - 1) * 0.06);

    const waveNames = {
      1: 'Đội hình Chữ V (Truy xuất)',
      2: 'Đội hình Lượn Sóng',
      3: 'Gọng Kìm & Tinh Anh Cloze',
      4: 'Cộng Hưởng Gốc Từ',
      5: '👑 BOSS Tàu Mẹ Cloze 3 Giáp',
    };
    if ($('sqWaveBadge')) {
      $('sqWaveBadge').textContent = `Đợt ${waveNum} / ${sqState.maxWaves} · ${waveNames[waveNum] || ''}`;
    }

    const waveBannerText = waveNum === 5
      ? '⚠️ CẢNH BÁO: BOSS TÀU MẸ 3 LỚP GIÁP CLOZE!'
      : `ĐỢT ${waveNum}: ${waveNames[waveNum].toUpperCase()}`;
    sqState.floatingTexts.push({
      x: SQ_W / 2,
      y: SQ_H / 2 - 20,
      text: waveBannerText,
      color: waveNum === 5 ? '#E5624F' : '#5BA4C8',
      life: 1.9,
      maxLife: 1.9,
      big: true,
    });

    const spawned = [];
    if (waveNum === 1) {
      const count = isLongDeck ? 2 : 3;
      const xs = count === 2 ? [255, 665] : [165, 460, 755];
      const ys = count === 2 ? [45, 145] : [44, 138, 44];
      for (let i = 0; i < count; i++) {
        const item = pickNextWordItem();
        if (!item) continue;
        spawned.push(createEnemyFromItem(item, {
          x: xs[i],
          y: ys[i],
          vy: baseVy,
          swayAmp: 8,
          swayFreq: 1.1,
          phase: i * 0.9,
        }));
      }
    } else if (waveNum === 2) {
      const count = isLongDeck ? 3 : 4;
      const xs = count === 3 ? [230, 690, 460] : [185, 735, 315, 605];
      for (let i = 0; i < count; i++) {
        const item = pickNextWordItem();
        if (!item) continue;
        spawned.push(createEnemyFromItem(item, {
          x: xs[i],
          y: 42 - i * 104,
          vy: baseVy * 1.02,
          swayAmp: 12,
          swayFreq: 1.25,
          phase: i * 0.8,
        }));
      }
    } else if (waveNum === 3) {
      const wingXs = [185, 735];
      for (let i = 0; i < 2; i++) {
        const item = pickNextWordItem();
        if (!item) continue;
        spawned.push(createEnemyFromItem(item, {
          x: wingXs[i],
          y: 42 - i * 105,
          vy: baseVy,
          swayAmp: 10,
          swayFreq: 1.2,
          phase: i * Math.PI,
        }));
      }
      const eliteItem = pickNextPhraseItem();
      if (eliteItem) {
        spawned.push(createEnemyFromItem(eliteItem, {
          x: SQ_W / 2,
          y: -175,
          vy: baseVy * 0.72,
          swayAmp: 10,
          swayFreq: 0.85,
          phase: 0,
          isElite: true,
        }));
      }
    } else if (waveNum === 4) {
      const count = isLongDeck ? 3 : 4;
      const xs = count === 3 ? [220, 700, 460] : [200, 720, 320, 600];
      const items = pickRootClusterWords(count);
      items.forEach((item, i) => {
        spawned.push(createEnemyFromItem(item, {
          x: xs[i % xs.length],
          y: 42 - i * 104,
          vy: baseVy * 1.04,
          swayAmp: 12,
          swayFreq: 1.2,
          phase: i * 0.6,
        }));
      });
    } else if (waveNum >= 5) {
      const stages = buildBossArmorStages(deckMode);
      if (stages.length) {
        spawned.push(createEnemyFromItem(stages[0], {
          x: SQ_W / 2,
          y: 46,
          vy: Math.max(5.5, baseVy * 0.34),
          swayAmp: 16,
          swayFreq: 0.55,
          phase: 0,
          isBoss: true,
          armorStages: stages,
        }));
      }
      const flankItem = pickNextWordItem();
      if (flankItem) {
        spawned.push(createEnemyFromItem(flankItem, {
          x: 165,
          y: -95,
          vy: baseVy * 0.85,
          swayAmp: 10,
          swayFreq: 1.1,
          phase: 0.7,
        }));
      }
      sqState.bossEscortTimer = 9.0;
    }

    sqState.enemies.push(...spawned);
    if (recallMode === 'audio_radar' && spawned.length) {
      const active = speakActiveAudioTarget(0.92);
      if (active) sqState.focusedId = active.id;
    }
    updateSquadronHud();
  }

  function wrapCanvasLines(ctx, text, maxWidth, maxLines = 3) {
    const raw = String(text || '').trim();
    if (!raw) return [''];
    const words = raw.split(/\s+/);
    const lines = [];
    let current = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const cand = current ? `${current} ${word}` : word;
      if (lines.length < maxLines - 1) {
        if (ctx.measureText(cand).width <= maxWidth || !current) {
          current = cand;
        } else {
          lines.push(current);
          current = word;
        }
      } else {
        current = cand;
      }
    }
    if (current) {
      let last = current;
      while (last.length > 6 && ctx.measureText(last).width > maxWidth) {
        last = `${last.slice(0, -2)}…`;
      }
      lines.push(last);
    }
    return lines.length ? lines : [''];
  }

  function getEnemyCardPresentation(enemy, recallMode) {
    const stage = getEnemyStage(enemy);
    const isFullVisible = recallMode === 'speed_visible' || Boolean(enemy.revealed) || (enemy.radarLevel || 0) >= 2;
    const isRadar1 = !isFullVisible && (enemy.radarLevel || 0) === 1;

    const posTag = stage.posShort ? `(${stage.posShort}) ` : '';
    const rootTag = stage.rootMeaningVi ? ` · gốc [${stage.rootMeaningVi}]` : '';
    const fullClue = `${posTag}${stage.vi}${rootTag}`;

    let clueText = '';
    if (recallMode === 'audio_radar') {
      clueText = (isRadar1 || isFullVisible)
        ? fullClue
        : '🔊 Nghe & gõ đáp án · [Alt+R] Nghe lại';
    } else if (recallMode === 'morph_forge') {
      if (stage.isCloze) {
        clueText = `${posTag}${stage.vi}${stage.morphVi ? ` · ${stage.morphVi}` : ''}`;
      } else if (isRadar1 || isFullVisible) {
        clueText = stage.morphVi ? `🧬 ${stage.morphVi} · ${posTag}${stage.vi}` : fullClue;
      } else {
        clueText = (stage.hasMultiParts && stage.morphVi)
          ? `🧬 ${stage.morphVi}${stage.posShort ? ` · (${stage.posShort})` : ''}`
          : fullClue;
      }
    } else {
      clueText = fullClue;
    }

    let targetText = '';
    if (isFullVisible) {
      if (stage.isCloze) {
        targetText = `${stage.fullText} [${stage.matchedForm}]`;
      } else {
        targetText = `${stage.answerWord}${stage.ipa ? `  ${stage.ipa}` : ''}`;
      }
    } else if (isRadar1) {
      if (stage.isCloze) {
        const hintBits = [stage.ipa || `(${stage.answerLen} chữ)`, stage.morphVi].filter(Boolean).join(' · ');
        targetText = `${stage.displayCloze}  [${hintBits}]`;
      } else {
        const hintBits = [stage.ipa || '/…/', stage.morphVi].filter(Boolean).join(' · ');
        targetText = `${hintBits} (${stage.answerLen})`;
      }
    } else {
      if (stage.isCloze) {
        targetText = stage.displayCloze;
      } else {
        const dots = '• '.repeat(Math.min(12, stage.answerLen)).trim();
        targetText = `${dots} (${stage.answerLen})`;
      }
    }

    const armorBadge = (enemy.armorStages && enemy.armorStages.length > 1)
      ? `${enemy.armorStages.map((_, idx) => (idx >= (enemy.armorIdx || 0) ? '🛡️' : '💥')).join('')} ${enemy.armorIdx + 1}/${enemy.armorStages.length}`
      : '';

    return {
      clueText,
      targetText,
      armorBadge,
      isFullVisible,
      isRadar1,
      stage,
    };
  }

  function spawnParticles(x, y, color, count = 16) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 45 + Math.random() * 170;
      sqState.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r: 2 + Math.random() * 3.5,
        color,
        life: 0.45 + Math.random() * 0.35,
        maxLife: 0.8,
      });
    }
  }

  function recordStageOutcome(stage, usedRadar) {
    if (!stage) return;
    const recordMeta = {
      w: stage.answerWord,
      vi: stage.vi,
      rootId: stage.rootId,
      rootMeaningVi: stage.rootMeaningVi,
    };
    if (usedRadar || !sqState.sessionRecallEligible) {
      sqState.cleanKills.delete(stage.key);
      if (usedRadar) {
        sqState.missedWords.set(stage.key, recordMeta);
      }
    } else if (!sqState.missedWords.has(stage.key)) {
      sqState.cleanKills.set(stage.key, recordMeta);
    }
  }

  function pushConsolidationBanner(stage) {
    if (!stage) return;
    const morphInfo = stage.morphLatin ? ` · ${stage.morphLatin}` : (stage.rootMeaningVi ? ` · gốc [${stage.rootMeaningVi}]` : '');
    sqState.consolidations.unshift({
      text: `✓ ${stage.answerWord}${stage.ipa ? ` ${stage.ipa}` : ''}${morphInfo}`,
      life: 2.3,
      maxLife: 2.3,
    });
    if (sqState.consolidations.length > 2) sqState.consolidations.length = 2;
  }

  function triggerRootResonanceEffect(destroyedEnemy, destroyedStage) {
    const rootId = destroyedStage?.rootId || destroyedEnemy?.rootId;
    if (!rootId) return;
    const siblings = sqState.enemies.filter((other) => {
      if (other.id === destroyedEnemy.id) return false;
      const oStage = getEnemyStage(other);
      return (oStage?.rootId || other.rootId) === rootId;
    });
    if (!siblings.length) return;

    const targetSib = siblings[0];
    sqState.lightnings.push({
      x1: destroyedEnemy.x,
      y1: destroyedEnemy.y,
      x2: targetSib.x,
      y2: targetSib.y,
      color: destroyedEnemy.color,
      life: 0.52,
      maxLife: 0.52,
    });
    // Push back & slow down sibling without auto-killing or revealing answer!
    targetSib.y = targetSib.y > 20 ? Math.max(20, targetSib.y - 52) : (targetSib.y - 30);
    targetSib.slowTimer = Math.max(targetSib.slowTimer || 0, 3.5);
    targetSib.hitFlash = 0.28;
    sqState.score += 40;
    const rootVi = getRootMeaningVi(rootId);
    sqState.floatingTexts.push({
      x: targetSib.x,
      y: targetSib.y - 26,
      text: `⚡ CỘNG HƯỞNG GỐC [${rootVi || rootId}]! Đẩy lùi +40`,
      color: '#FBBF24',
      life: 1.35,
      maxLife: 1.35,
    });
  }

  function destroySquadronEnemy(enemy, stageArg = null) {
    const stage = stageArg || getEnemyStage(enemy);
    sqState.enemies = sqState.enemies.filter((e) => e.id !== enemy.id);
    if (sqState.focusedId === enemy.id) sqState.focusedId = null;

    const basePts = enemy.isBoss ? 500 : enemy.isElite ? 220 : 120;
    const comboMult = 1 + Math.min(4, Math.floor(sqState.combo / 5) * 0.5);
    const pts = Math.round(basePts * comboMult);
    sqState.score += pts;

    spawnParticles(enemy.x, enemy.y, enemy.color, enemy.isBoss ? 44 : 20);
    sqState.floatingTexts.push({
      x: enemy.x,
      y: enemy.y - 14,
      text: `+${pts} · ${stage?.answerWord || enemy.answerWord}`,
      color: '#52B788',
      life: 1.5,
      maxLife: 1.5,
      big: enemy.isBoss,
    });

    if (stage) {
      speakEnglish(stage.audioText || stage.answerWord, 'en-US', 0.96);
      recordStageOutcome(stage, enemy.usedRadar);
      pushConsolidationBanner(stage);
    }

    triggerRootResonanceEffect(enemy, stage);

    if (($('sqRecallSelect')?.value || '') === 'audio_radar' && sqState.enemies.length > 0) {
      sqState.nextAudioTimer = 0.85;
    }

    checkWaveClearedOrNext();
    updateSquadronHud();
  }

  function checkWaveClearedOrNext() {
    if (!sqState.running || sqState.finished) return;
    if (sqState.enemies.length === 0 && !sqState.wavePendingSpawn) {
      if (sqState.wave >= sqState.maxWaves) {
        finishSquadronCampaign(true);
      } else {
        sqState.wavePendingSpawn = true;
        sqState.waveDelayTimer = 1.25;
      }
    }
  }

  function setSquadronFeedback(msg, kind = '') {
    sqState.feedbackMsg = msg;
    sqState.feedbackKind = kind;
    sqState.feedbackTimer = msg ? 3.0 : 0;
    updateSquadronHud();
  }

  function triggerSquadronRadar() {
    if (!sqState.running || sqState.paused || sqState.finished) return;
    let target = sqState.enemies.find((e) => e.id === sqState.focusedId);
    if (!target && sqState.enemies.length) {
      target = sqState.enemies.slice().sort((a, b) => b.y - a.y)[0];
    }
    if (!target) return;

    sqState.focusedId = target.id;
    const stage = getEnemyStage(target);
    target.usedRadar = true;
    sqState.radarPulse = 0.6;
    if (stage) {
      recordStageOutcome(stage, true);
      speakEnglish(stage.audioText || stage.answerWord, 'en-US', 0.88);
    }

    if ((target.radarLevel || 0) === 0) {
      target.radarLevel = 1;
      setSquadronFeedback(
        `📡 Radar Tầng 1: Đã đọc phát âm & bật gợi ý IPA / Nghĩa gốc — bấm [Tab] lần nữa để hiện đáp án`,
        'hint'
      );
    } else {
      target.radarLevel = 2;
      target.revealed = true;
      setSquadronFeedback(
        `📡 Radar Tầng 2: Đã mở đáp án ("${stage?.answerWord || ''}") · Từ này sẽ đưa vào hàng ôn tập`,
        'warn'
      );
    }
    updateSquadronHud();
  }

  function triggerSquadronEmp() {
    if (!sqState.running || sqState.paused || sqState.finished) return;
    if (sqState.empCharge < 100) return;
    sqState.empCharge = 0;
    sqState.shockwaves.push({ x: SQ_W / 2, y: SQ_H - 42, r: 20, maxR: SQ_W, life: 0.75, maxLife: 0.75 });
    sqState.floatingTexts.push({
      x: SQ_W / 2,
      y: SQ_H / 2,
      text: '❄️ SÓNG ĐẨY LÙI! ĐÓNG BĂNG TOÀN ĐỘI HÌNH 4.5s',
      color: '#38BDF8',
      life: 1.6,
      maxLife: 1.6,
      big: true,
    });
    // Push back & freeze all active enemies without killing or awarding free SRS kills!
    sqState.enemies.forEach((e) => {
      e.y = e.y > 18 ? Math.max(18, e.y - 135) : (e.y - 60);
      e.freezeTimer = Math.max(e.freezeTimer || 0, 4.5);
      e.hitFlash = 0.3;
    });
    getBridge()?.playWoodTap?.(true);
    setSquadronFeedback('❄️ Đã kích hoạt Đẩy Lùi! Toàn đội hình lùi lại & đóng băng 4.5s.', 'ok');
  }

  function clearSquadronInputAndFocus() {
    if ($('sqTypeInput')) $('sqTypeInput').value = '';
    sqState.draftText = '';
    sqState.focusedId = null;
    setSquadronFeedback('', '');
  }

  function fireSquadronWord() {
    if (!sqState.running || sqState.paused || sqState.finished) return;
    const inputEl = $('sqTypeInput');
    const raw = (inputEl ? inputEl.value : sqState.draftText) || '';
    const typed = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!typed) return;

    // Order candidates: focused target first, then closest to defense line (highest y)
    const ordered = sqState.enemies.slice().sort((a, b) => {
      if (a.id === sqState.focusedId) return -1;
      if (b.id === sqState.focusedId) return 1;
      return b.y - a.y;
    });

    let hitEnemy = null;
    let hitStage = null;
    for (const enemy of ordered) {
      const stage = getEnemyStage(enemy);
      if (stage && stage.acceptedAnswers.includes(typed)) {
        hitEnemy = enemy;
        hitStage = stage;
        break;
      }
    }

    if (hitEnemy && hitStage) {
      if (inputEl) inputEl.value = '';
      sqState.draftText = '';
      sqState.hits += 1;
      sqState.combo += 1;
      if (sqState.combo > sqState.maxCombo) sqState.maxCombo = sqState.combo;
      sqState.empCharge = Math.min(100, sqState.empCharge + 20);
      sqState.turretAngle = Math.atan2(hitEnemy.y - (SQ_H - 38), hitEnemy.x - SQ_W / 2);
      sqState.muzzleFlash = 0.16;

      sqState.projectiles.push({
        x: SQ_W / 2 + Math.cos(sqState.turretAngle) * 26,
        y: (SQ_H - 38) + Math.sin(sqState.turretAngle) * 26,
        tx: hitEnemy.x,
        ty: hitEnemy.y,
        color: hitEnemy.color,
        life: 0.16,
        maxLife: 0.16,
      });

      getBridge()?.playWoodTap?.(true);

      if (hitEnemy.armorStages && hitEnemy.armorIdx < hitEnemy.armorStages.length - 1) {
        // Broke one Boss shield layer cleanly!
        recordStageOutcome(hitStage, hitEnemy.usedRadar);
        pushConsolidationBanner(hitStage);
        speakEnglish(hitStage.audioText || hitStage.answerWord, 'en-US', 0.96);

        sqState.score += 200;
        spawnParticles(hitEnemy.x, hitEnemy.y, '#FBBF24', 24);
        sqState.floatingTexts.push({
          x: hitEnemy.x,
          y: hitEnemy.y - 24,
          text: `💥 VỠ GIÁP ${hitEnemy.armorIdx + 1}/${hitEnemy.armorStages.length}! +200`,
          color: '#FBBF24',
          life: 1.5,
          maxLife: 1.5,
          big: true,
        });

        hitEnemy.armorIdx += 1;
        hitEnemy.radarLevel = 0;
        hitEnemy.revealed = false;
        hitEnemy.usedRadar = false;
        hitEnemy.hitFlash = 0.25;
        hitEnemy.y = Math.max(22, hitEnemy.y - 40);

        if (($('sqRecallSelect')?.value || '') === 'audio_radar') {
          sqState.nextAudioTimer = 1.05;
        }
        setSquadronFeedback(`💥 Phá vỡ Giáp ${hitEnemy.armorIdx}/${hitEnemy.armorStages.length} của BOSS! Tiếp tục điền lớp giáp tiếp theo!`, 'ok');
      } else {
        setSquadronFeedback(`✓ Chính xác: "${hitStage.answerWord}"${hitStage.ipa ? ` ${hitStage.ipa}` : ''}`, 'ok');
        destroySquadronEnemy(hitEnemy, hitStage);
      }
      return;
    }

    // No exact match — check for close spelling typo using computeEditDistance (WITHOUT spoiling answer)
    sqState.misses += 1;
    sqState.combo = 0;
    sqState.muzzleError = 0.32;
    getBridge()?.playWoodTap?.(false);

    let nearMiss = false;
    if (typed.length >= 2) {
      for (const enemy of ordered) {
        const stage = getEnemyStage(enemy);
        if (!stage) continue;
        for (const ans of stage.acceptedAnswers) {
          if (ans.includes(' ')) continue;
          const maxDist = ans.length <= 5 ? 1 : 2;
          if (computeEditDistance(typed, ans) <= maxDist) {
            nearMiss = true;
            break;
          }
        }
        if (nearMiss) break;
      }
    }

    if (nearMiss) {
      setSquadronFeedback(
        `⚠️ Gần đúng chính tả ("${raw.trim()}") — kiểm tra lại 1–2 ký tự rồi bấm Enter!`,
        'warn'
      );
    } else {
      setSquadronFeedback(
        `❌ Không có mục tiêu khớp "${raw.trim()}" — bấm [Tab] để dùng Radar 2 tầng`,
        'warn'
      );
      if (inputEl && document.activeElement === inputEl) {
        inputEl.select();
      }
    }
  }

  function updateSquadronPhysics(dt) {
    if (!sqState.running || sqState.paused || sqState.finished) return;
    sqState.elapsed += dt;

    if (sqState.wavePendingSpawn) {
      sqState.waveDelayTimer -= dt;
      if (sqState.waveDelayTimer <= 0) {
        spawnSquadronWave(sqState.wave + 1);
      }
    }

    if (sqState.nextAudioTimer > 0) {
      sqState.nextAudioTimer -= dt;
      if (sqState.nextAudioTimer <= 0) {
        sqState.nextAudioTimer = 0;
        if (($('sqRecallSelect')?.value || '') === 'audio_radar' && sqState.enemies.length) {
          const active = speakActiveAudioTarget(0.92);
          if (active) sqState.focusedId = active.id;
        }
      }
    }

    if (sqState.muzzleFlash > 0) sqState.muzzleFlash = Math.max(0, sqState.muzzleFlash - dt);
    if (sqState.muzzleError > 0) sqState.muzzleError = Math.max(0, sqState.muzzleError - dt);
    if (sqState.radarPulse > 0) sqState.radarPulse = Math.max(0, sqState.radarPulse - dt);
    if (sqState.feedbackTimer > 0) {
      sqState.feedbackTimer -= dt;
      if (sqState.feedbackTimer <= 0) {
        sqState.feedbackTimer = 0;
        sqState.feedbackMsg = '';
        sqState.feedbackKind = '';
        updateSquadronHud();
      }
    }

    // Boss drops max 1 escort at a time so screen stays uncluttered
    const activeBoss = sqState.enemies.find((e) => e.isBoss);
    if (activeBoss && activeBoss.y > 120 && sqState.enemies.length < 2) {
      sqState.bossEscortTimer -= dt;
      if (sqState.bossEscortTimer <= 0) {
        sqState.bossEscortTimer = 8.5;
        const wItem = pickNextWordItem();
        if (wItem) {
          const dropX = activeBoss.x > SQ_W / 2 ? 175 : SQ_W - 175;
          sqState.enemies.push(createEnemyFromItem(wItem, {
            x: dropX,
            y: -45,
            vy: 14 * getSpeedMultiplier(),
            swayAmp: 10,
            swayFreq: 1.1,
            phase: Math.random() * 3,
          }));
        }
      }
    }

    const breached = [];
    sqState.enemies.forEach((e) => {
      if (e.freezeTimer > 0) {
        e.freezeTimer = Math.max(0, e.freezeTimer - dt);
      } else {
        const slowMult = e.slowTimer > 0 ? 0.45 : 1.0;
        if (e.slowTimer > 0) e.slowTimer = Math.max(0, e.slowTimer - dt);
        e.y += e.vy * slowMult * dt;
      }
      const swayX = e.baseX + Math.sin(sqState.elapsed * e.swayFreq + e.phase) * e.swayAmp;
      const margin = e.isBoss ? 290 : e.isElite ? 190 : 145;
      e.x = Math.max(margin, Math.min(SQ_W - margin, swayX));
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);

      if (e.y >= SQ_H - 72) {
        breached.push(e);
      }
    });

    if (breached.length) {
      breached.forEach((e) => {
        const stage = getEnemyStage(e);
        sqState.enemies = sqState.enemies.filter((x) => x.id !== e.id);
        if (sqState.focusedId === e.id) sqState.focusedId = null;
        sqState.shields = Math.max(0, sqState.shields - (e.isBoss ? 2 : 1));
        sqState.combo = 0;
        sqState.misses += 1;
        if (stage) {
          sqState.cleanKills.delete(stage.key);
          sqState.missedWords.set(stage.key, {
            w: stage.answerWord,
            vi: stage.vi,
            rootId: stage.rootId,
            rootMeaningVi: stage.rootMeaningVi,
          });
        }
        spawnParticles(e.x, SQ_H - 68, '#E5624F', 24);
        sqState.floatingTexts.push({
          x: e.x,
          y: SQ_H - 88,
          text: `Lọt: ${stage?.answerWord || ''} (${stage?.vi || ''})`,
          color: '#E5624F',
          life: 2.0,
          maxLife: 2.0,
        });
      });
      getBridge()?.playWoodTap?.(false);
      updateSquadronHud();
      if (sqState.shields <= 0) {
        finishSquadronCampaign(false);
        return;
      }
      if (($('sqRecallSelect')?.value || '') === 'audio_radar' && sqState.enemies.length > 0) {
        sqState.nextAudioTimer = 0.65;
      }
      checkWaveClearedOrNext();
    }

    sqState.projectiles = sqState.projectiles.filter((p) => {
      p.life -= dt;
      return p.life > 0;
    });
    sqState.particles = sqState.particles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      return p.life > 0;
    });
    sqState.lightnings = sqState.lightnings.filter((l) => {
      l.life -= dt;
      return l.life > 0;
    });
    sqState.shockwaves = sqState.shockwaves.filter((s) => {
      s.life -= dt;
      s.r = s.maxR * (1 - s.life / s.maxLife);
      return s.life > 0;
    });
    sqState.floatingTexts = sqState.floatingTexts.filter((f) => {
      f.y -= 18 * dt;
      f.life -= dt;
      return f.life > 0;
    });
    sqState.consolidations = sqState.consolidations.filter((c) => {
      c.life -= dt;
      return c.life > 0;
    });

    const active = pickActiveAudioTarget();
    if (active) {
      sqState.turretAngle = Math.atan2(active.y - (SQ_H - 38), active.x - SQ_W / 2);
    }
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function renderSquadronCanvas() {
    const canvas = $('sqCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 0, SQ_H);
    grad.addColorStop(0, '#0C131E');
    grad.addColorStop(1, '#142235');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SQ_W, SQ_H);

    ctx.fillStyle = 'rgba(230, 236, 245, 0.28)';
    sqState.stars.forEach((st) => {
      const sy = (st.y + sqState.elapsed * st.s) % SQ_H;
      ctx.fillRect(st.x, sy, st.sz, st.sz);
    });

    ctx.strokeStyle = 'rgba(91, 164, 200, 0.08)';
    ctx.lineWidth = 1;
    for (let gx = 80; gx < SQ_W; gx += 80) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, SQ_H);
      ctx.stroke();
    }
    for (let gy = 80; gy < SQ_H; gy += 80) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(SQ_W, gy);
      ctx.stroke();
    }

    // Defense line
    const defY = SQ_H - 72;
    ctx.strokeStyle = sqState.muzzleError > 0 ? 'rgba(229, 98, 79, 0.78)' : 'rgba(91, 164, 200, 0.35)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(20, defY);
    ctx.lineTo(SQ_W - 20, defY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (sqState.radarPulse > 0) {
      ctx.strokeStyle = `rgba(56, 189, 248, ${sqState.radarPulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(SQ_W / 2, SQ_H - 38, (1 - sqState.radarPulse / 0.6) * SQ_W * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    }

    sqState.shockwaves.forEach((s) => {
      ctx.strokeStyle = `rgba(56, 189, 248, ${s.life / s.maxLife})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
    });

    sqState.lightnings.forEach((l) => {
      const alpha = l.life / l.maxLife;
      ctx.strokeStyle = `rgba(251, 191, 36, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        const jx = l.x1 + (l.x2 - l.x1) * t + (Math.random() - 0.5) * 28;
        const jy = l.y1 + (l.y2 - l.y1) * t + (Math.random() - 0.5) * 28;
        ctx.lineTo(jx, jy);
      }
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    });

    const focusedEnemy = sqState.enemies.find((e) => e.id === sqState.focusedId);
    if (focusedEnemy) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(SQ_W / 2, SQ_H - 42);
      ctx.lineTo(focusedEnemy.x, focusedEnemy.y + 18);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    sqState.projectiles.forEach((p) => {
      const prog = 1 - p.life / p.maxLife;
      const cx = p.x + (p.tx - p.x) * prog;
      const cy = p.y + (p.ty - p.y) * prog;
      ctx.strokeStyle = p.color || '#52B788';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(p.x + (p.tx - p.x) * Math.max(0, prog - 0.25), p.y + (p.ty - p.y) * Math.max(0, prog - 0.25));
      ctx.lineTo(cx, cy);
      ctx.stroke();
    });

    // Enemies (Pure Vietnamese Clue + Dot/Cloze Mask — Zero Free Letters)
    const recallMode = $('sqRecallSelect')?.value || 'blind_meaning';
    const orderedEnemies = sqState.enemies.slice().sort((a, b) => (a.id === sqState.focusedId ? 1 : b.id === sqState.focusedId ? -1 : 0));

    orderedEnemies.forEach((e) => {
      const isFocused = e.id === sqState.focusedId;
      const pres = getEnemyCardPresentation(e, recallMode);
      const maxCardW = e.isBoss ? 560 : e.isElite ? 370 : 280;
      const minCardW = e.isBoss ? 380 : e.isElite ? 220 : 184;

      ctx.save();
      ctx.font = '600 12px "Be Vietnam Pro", sans-serif';
      const clueW = ctx.measureText(pres.clueText).width;
      const targetFont = pres.stage.isCloze ? '600 13px "JetBrains Mono", monospace' : 'bold 14px "JetBrains Mono", monospace';
      ctx.font = targetFont;
      const rawTargetW = ctx.measureText(pres.targetText).width;
      const boxW = Math.max(minCardW, Math.min(maxCardW, Math.max(clueW, Math.min(maxCardW - 28, rawTargetW)) + 30));

      const targetLines = wrapCanvasLines(ctx, pres.targetText, boxW - 24, e.isBoss ? 3 : 2);
      const lineHeight = e.isBoss ? 18 : 17;
      const extraTop = pres.armorBadge ? 14 : 0;
      const boxH = 34 + extraTop + targetLines.length * lineHeight;

      const shipY = e.y - 24;
      const isFrozen = e.freezeTimer > 0;
      ctx.fillStyle = e.hitFlash > 0 ? '#FFFFFF' : isFrozen ? '#38BDF8' : e.color;
      ctx.beginPath();
      if (e.isBoss) {
        ctx.moveTo(e.x, shipY - 18);
        ctx.lineTo(e.x + 54, shipY - 4);
        ctx.lineTo(e.x + 38, shipY + 10);
        ctx.lineTo(e.x - 38, shipY + 10);
        ctx.lineTo(e.x - 54, shipY - 4);
      } else {
        ctx.moveTo(e.x, shipY - 13);
        ctx.lineTo(e.x + (e.isElite ? 26 : 18), shipY + 2);
        ctx.lineTo(e.x + 7, shipY + 8);
        ctx.lineTo(e.x - 7, shipY + 8);
        ctx.lineTo(e.x - (e.isElite ? 26 : 18), shipY + 2);
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = isFocused ? '#FBBF24' : '#0C131E';
      ctx.beginPath();
      ctx.arc(e.x, shipY - 1, e.isBoss ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fill();

      const px = e.x - boxW / 2;
      const py = e.y - 10;
      e._rect = { x: px, y: shipY - 16, w: boxW, h: boxH + 16 };

      drawRoundedRect(ctx, px, py, boxW, boxH, 9);
      ctx.fillStyle = isFocused ? 'rgba(20, 36, 58, 0.97)' : 'rgba(13, 20, 31, 0.92)';
      ctx.fill();
      ctx.lineWidth = isFocused ? 2.2 : isFrozen ? 1.8 : 1.2;
      ctx.strokeStyle = isFocused ? '#FBBF24' : isFrozen ? '#38BDF8' : e.color;
      ctx.stroke();

      let curY = py + 13;
      if (pres.armorBadge) {
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FBBF24';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pres.armorBadge, e.x, curY);
        curY += 15;
      }

      // Clue line (Meaning + Vietnamese Root Meaning — zero Latin word leaks)
      ctx.font = '600 12px "Be Vietnam Pro", sans-serif';
      ctx.fillStyle = '#E2E8F0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let clippedClue = pres.clueText;
      while (clippedClue.length > 10 && ctx.measureText(clippedClue).width > boxW - 20) {
        clippedClue = `${clippedClue.slice(0, -2)}…`;
      }
      ctx.fillText(clippedClue, e.x, curY);
      curY += 18;

      // Target mask / Cloze lines / IPA Radar-1 / Full Answer Radar-2
      ctx.font = targetFont;
      ctx.fillStyle = pres.isFullVisible ? '#52B788' : pres.isRadar1 ? '#38BDF8' : '#CBD5E1';
      targetLines.forEach((line, lIdx) => {
        ctx.fillText(line, e.x, curY + lIdx * lineHeight);
      });

      if (e.armorStages && e.armorStages.length > 1) {
        const pct = Math.max(0, Math.min(1, 1 - (e.armorIdx || 0) / e.armorStages.length));
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(px + 12, py + boxH - 6, boxW - 24, 3);
        ctx.fillStyle = '#E5624F';
        ctx.fillRect(px + 12, py + boxH - 6, (boxW - 24) * pct, 3);
      }

      ctx.restore();
    });

    // Particles
    sqState.particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Consolidation banners (brief post-kill reinforcement: word + IPA + root formula)
    sqState.consolidations.forEach((c, idx) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, c.life / 0.6));
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      const w = Math.min(SQ_W - 40, ctx.measureText(c.text).width + 26);
      const bx = SQ_W / 2 - w / 2;
      const by = 12 + idx * 30;
      drawRoundedRect(ctx, bx, by, w, 24, 6);
      ctx.fillStyle = 'rgba(20, 48, 42, 0.90)';
      ctx.fill();
      ctx.strokeStyle = '#52B788';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#A7F3D0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, SQ_W / 2, by + 12);
      ctx.restore();
    });

    // Floating combat texts
    sqState.floatingTexts.forEach((f) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.maxLife));
      ctx.fillStyle = f.color;
      ctx.font = f.big ? 'bold 16.5px "Be Vietnam Pro", sans-serif' : 'bold 13px "Be Vietnam Pro", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    });

    // Bottom Fortress Turret + Cannon Draft Chamber Pill
    ctx.save();
    ctx.translate(SQ_W / 2, SQ_H - 42);
    ctx.rotate(sqState.turretAngle + Math.PI / 2);
    ctx.fillStyle = sqState.muzzleError > 0 ? '#E5624F' : '#5BA4C8';
    ctx.fillRect(-5, -28, 10, 22);
    ctx.fillStyle = '#E9E6DC';
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    if (sqState.muzzleFlash > 0) {
      ctx.fillStyle = '#FBBF24';
      ctx.beginPath();
      ctx.arc(0, -32, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (sqState.running && sqState.draftText) {
      const draftShow = sqState.draftText.slice(-36);
      ctx.save();
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      const dw = Math.max(120, Math.min(380, ctx.measureText(draftShow).width + 26));
      drawRoundedRect(ctx, SQ_W / 2 - dw / 2, SQ_H - 28, dw, 22, 6);
      ctx.fillStyle = sqState.muzzleError > 0 ? 'rgba(110, 30, 26, 0.92)' : 'rgba(16, 30, 48, 0.92)';
      ctx.fill();
      ctx.strokeStyle = sqState.muzzleError > 0 ? '#E5624F' : '#FBBF24';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(draftShow, SQ_W / 2, SQ_H - 17);
      ctx.restore();
    }
  }

  function updateSquadronHud() {
    if ($('sqScoreVal')) $('sqScoreVal').textContent = String(sqState.score);
    if ($('sqComboVal')) $('sqComboVal').textContent = `x${sqState.combo}`;
    const totalPresses = sqState.hits + sqState.misses;
    const acc = totalPresses ? Math.round((sqState.hits / totalPresses) * 100) : 100;
    if ($('sqAccVal')) $('sqAccVal').textContent = `${acc}%`;
    if ($('sqEmpPct')) $('sqEmpPct').textContent = String(sqState.empCharge);
    const empBtn = $('sqEmpBtn');
    if (empBtn) {
      empBtn.disabled = sqState.empCharge < 100 || !sqState.running;
      empBtn.classList.toggle('emp-ready', sqState.empCharge >= 100);
    }
    if ($('sqShieldsVal')) {
      $('sqShieldsVal').textContent = '♥'.repeat(sqState.shields) + '♡'.repeat(Math.max(0, sqState.maxShields - sqState.shields));
    }

    const lockEl = $('sqLockStatus');
    if (lockEl) {
      lockEl.classList.remove('is-warn', 'is-ok', 'is-hint');
      if (sqState.feedbackMsg) {
        lockEl.textContent = sqState.feedbackMsg;
        if (sqState.feedbackKind) lockEl.classList.add(`is-${sqState.feedbackKind}`);
      } else {
        const focused = sqState.enemies.find((e) => e.id === sqState.focusedId);
        if (focused) {
          const stage = getEnemyStage(focused);
          const rootTag = stage?.rootMeaningVi ? ` · gốc [${stage.rootMeaningVi}]` : '';
          const cluePreview = (($('sqRecallSelect')?.value || '') === 'audio_radar' && (focused.radarLevel || 0) === 0)
            ? 'Mục tiêu đang chọn (Nghe)'
            : `${stage?.vi || ''}${rootTag}`;
          lockEl.textContent = `🎯 Đang chọn: "${cluePreview}" · Gõ nguyên từ rồi bấm [Enter] (hoặc [Tab] Radar)`;
        } else {
          const starterHint = sqState.usingFallbackDeck ? ' (Đang dùng bộ từ cốt lõi mẫu vì bạn chưa có từ đã học)' : '';
          lockEl.textContent = `🎯 Nạp nguyên từ vào nòng pháo rồi bấm [Enter] để khai hỏa${starterHint}`;
        }
      }
    }
  }

  function squadronLoop(ts) {
    if (!sqState.running) return;
    if (!sqState.lastTs) sqState.lastTs = ts;
    const dt = Math.min(0.08, (ts - sqState.lastTs) / 1000);
    sqState.lastTs = ts;

    if (!sqState.paused && !sqState.finished) {
      updateSquadronPhysics(dt);
    }
    renderSquadronCanvas();

    if (sqState.running) {
      sqState.rafId = requestAnimationFrame(squadronLoop);
    }
  }

  function startSquadronGame() {
    initSquadronStage();
    if (sqState.rafId) cancelAnimationFrame(sqState.rafId);

    const recallMode = $('sqRecallSelect')?.value || 'blind_meaning';
    sqState.running = true;
    sqState.paused = false;
    sqState.finished = false;
    sqState.lastTs = 0;
    sqState.elapsed = 0;
    sqState.nextAudioTimer = 0;
    sqState.score = 0;
    sqState.combo = 0;
    sqState.maxCombo = 0;
    sqState.hits = 0;
    sqState.misses = 0;
    sqState.shields = sqState.maxShields;
    sqState.empCharge = 0;
    sqState.focusedId = null;
    sqState.sessionRecallEligible = recallMode !== 'speed_visible';
    sqState.draftText = '';
    sqState.feedbackMsg = '';
    sqState.feedbackKind = '';
    sqState.feedbackTimer = 0;
    sqState.enemies = [];
    sqState.projectiles = [];
    sqState.particles = [];
    sqState.lightnings = [];
    sqState.shockwaves = [];
    sqState.floatingTexts = [];
    sqState.consolidations = [];
    sqState.cleanKills = new Map();
    sqState.missedWords = new Map();
    sqState.deckPool = buildSquadronDeck();

    if ($('sqTypeInput')) $('sqTypeInput').value = '';
    $('sqBriefingOverlay')?.classList.add('hidden');
    $('sqSummaryOverlay')?.classList.add('hidden');
    $('sqSyncDoneNote')?.classList.add('hidden');
    if ($('sqSyncSrsBtn')) $('sqSyncSrsBtn').disabled = false;

    $('sqStartBtn').textContent = '↻ Chơi lại';
    $('sqPauseBtn')?.classList.remove('hidden');
    $('sqPauseBtn').textContent = '⏸ Tạm dừng';

    spawnSquadronWave(1);
    updateSquadronHud();
    sqState.rafId = requestAnimationFrame(squadronLoop);
    setTimeout(() => $('sqTypeInput')?.focus(), 30);
  }

  function pauseSquadronGame(silent = false) {
    if (!sqState.running || sqState.finished) return;
    sqState.paused = true;
    if (!silent && $('sqPauseBtn')) {
      $('sqPauseBtn').textContent = '▶ Tiếp tục';
    }
  }

  function toggleSquadronPause() {
    if (!sqState.running || sqState.finished) return;
    sqState.paused = !sqState.paused;
    if (!sqState.paused) {
      sqState.lastTs = 0;
      $('sqPauseBtn').textContent = '⏸ Tạm dừng';
      $('sqTypeInput')?.focus();
    } else {
      $('sqPauseBtn').textContent = '▶ Tiếp tục';
    }
  }

  function finishSquadronCampaign(victory) {
    sqState.running = false;
    sqState.finished = true;
    sqState.nextAudioTimer = 0;
    if (sqState.rafId) cancelAnimationFrame(sqState.rafId);

    $('sqPauseBtn')?.classList.add('hidden');
    const summaryEl = $('sqSummaryOverlay');
    if (!summaryEl) return;
    summaryEl.classList.remove('hidden');

    $('sqSummaryTitle').textContent = victory
      ? '🎉 CHIẾN THẮNG PHÒNG TUYẾN!'
      : '🛡️ PHÒNG TUYẾN BỊ CHỌC THỦNG — RÚT KINH NGHIỆM!';

    const totalPresses = sqState.hits + sqState.misses;
    const acc = totalPresses ? Math.round((sqState.hits / totalPresses) * 100) : 100;
    $('sqSummaryStats').innerHTML = `
      <span class="sq-summary-stat-pill">Điểm: <strong>${sqState.score}</strong></span>
      <span class="sq-summary-stat-pill">Combo tối đa: <strong>x${sqState.maxCombo}</strong></span>
      <span class="sq-summary-stat-pill">Chính xác: <strong>${acc}%</strong></span>
      <span class="sq-summary-stat-pill">Sóng đạt: <strong>Đợt ${sqState.wave}/${sqState.maxWaves}</strong></span>
    `;

    // Ensure missed words never also appear in cleanKills
    sqState.missedWords.forEach((_, key) => sqState.cleanKills.delete(key));
    const cleanArr = Array.from(sqState.cleanKills.values());
    const missArr = Array.from(sqState.missedWords.values());
    $('sqCleanCount').textContent = String(cleanArr.length);
    $('sqReviewCount').textContent = String(missArr.length);

    const renderChips = (containerId, list) => {
      const box = $(containerId);
      if (!box) return;
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = '<span class="sub-hint">Không có mục nào.</span>';
        return;
      }
      list.forEach((it) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sq-word-chip';
        btn.title = `${it.vi} — Bấm để nghe & mở trong Xưởng Gốc Từ`;
        btn.textContent = `${it.w}${it.rootMeaningVi ? ` · gốc [${it.rootMeaningVi}]` : (it.rootId ? ` (${it.rootId})` : '')}`;
        btn.addEventListener('click', () => {
          speakEnglish(it.w, 'en-US', 0.92);
          if (window.EnAtelierApp?.jumpToWord) {
            window.EnAtelierApp.jumpToWord(it.w);
          }
        });
        box.appendChild(btn);
      });
    };

    renderChips('sqCleanList', cleanArr);
    renderChips('sqReviewList', missArr);

    const syncBtn = $('sqSyncSrsBtn');
    const syncNote = $('sqSyncDoneNote');
    if (syncBtn && syncNote) {
      if (!sqState.sessionRecallEligible) {
        syncBtn.disabled = true;
        syncNote.textContent = 'Chế độ Hiện Rõ Mặt Chữ chỉ để luyện gõ nhanh, không tính điểm Active Recall vào SRS.';
        syncNote.classList.remove('hidden');
      } else {
        syncBtn.disabled = false;
        syncNote.classList.add('hidden');
      }
    }

    renderSquadronCanvas();
  }

  function syncSquadronToSrs() {
    if (!sqState.sessionRecallEligible) return;
    const bridge = getBridge();
    const map = getEnProgressMap();
    let updated = 0;
    let markedDue = 0;

    // Missed words ALWAYS take precedence over cleanKills and mark learned words due persistently
    sqState.missedWords.forEach((_, key) => sqState.cleanKills.delete(key));

    sqState.cleanKills.forEach((it) => {
      const word = it.w;
      if (!Object.hasOwn(map, word)) return; // Never create brand-new unlearned SRS cards automatically
      const wasDue = getWordStatus(word) === 'due';
      map[word].blindPasses = (map[word].blindPasses || 0) + 1;
      if (wasDue && bridge?.applySrsGradeToRecord) {
        map[word] = bridge.applySrsGradeToRecord(map[word], 3);
      }
      enState.sessionFailedSet.delete(word);
      updated += 1;
    });

    const dueNowIso = new Date(Date.now() - 1000).toISOString();
    sqState.missedWords.forEach((it) => {
      const word = it.w;
      enState.sessionFailedSet.add(word);
      if (Object.hasOwn(map, word)) {
        map[word].due = dueNowIso;
        markedDue += 1;
      }
    });

    bridge?.saveProgress?.(true);
    bridge?.updateDueBadges?.();
    updateTodayBadge();
    updateWordListDots();

    if ($('sqSyncDoneNote')) {
      $('sqSyncDoneNote').textContent = `Đã cập nhật phản xạ & lịch SM-2 cho ${updated} từ đã học; đặt lại hạn ôn cho ${markedDue} từ cần luyện thêm!`;
      $('sqSyncDoneNote').classList.remove('hidden');
    }
    if ($('sqSyncSrsBtn')) $('sqSyncSrsBtn').disabled = true;
  }

  function initSquadronStage() {
    if (!sqState.stars.length) {
      for (let i = 0; i < 42; i++) {
        sqState.stars.push({
          x: Math.random() * SQ_W,
          y: Math.random() * SQ_H,
          s: 8 + Math.random() * 18,
          sz: Math.random() > 0.7 ? 2 : 1.2,
        });
      }
    }
    if (!sqState.initialized) {
      sqState.initialized = true;
      renderSquadronCanvas();
    }
  }

  function bindSquadronEvents() {
    $('sqStartBtn')?.addEventListener('click', startSquadronGame);
    $('sqHeroLaunchBtn')?.addEventListener('click', startSquadronGame);
    $('sqPlayAgainBtn')?.addEventListener('click', startSquadronGame);
    $('sqPauseBtn')?.addEventListener('click', toggleSquadronPause);
    $('sqRadarBtn')?.addEventListener('click', () => {
      triggerSquadronRadar();
      $('sqTypeInput')?.focus();
    });
    $('sqReplayAudioBtn')?.addEventListener('click', () => {
      if (sqState.running && !sqState.finished) {
        speakActiveAudioTarget(0.9);
        $('sqTypeInput')?.focus();
      }
    });
    $('sqEmpBtn')?.addEventListener('click', () => {
      triggerSquadronEmp();
      $('sqTypeInput')?.focus();
    });
    $('sqFireBtn')?.addEventListener('click', () => {
      fireSquadronWord();
      $('sqTypeInput')?.focus();
    });
    $('sqUnlockBtn')?.addEventListener('click', () => {
      clearSquadronInputAndFocus();
      $('sqTypeInput')?.focus();
    });
    $('sqSyncSrsBtn')?.addEventListener('click', syncSquadronToSrs);

    $('sqRecallSelect')?.addEventListener('change', (e) => {
      if (sqState.running && e.target.value === 'speed_visible') {
        sqState.sessionRecallEligible = false;
      }
      if (sqState.running && e.target.value === 'audio_radar') {
        speakActiveAudioTarget(0.92);
      }
      if (sqState.running) renderSquadronCanvas();
    });

    $('sqBackToAtelierBtn')?.addEventListener('click', () => {
      setEnMode('anatomy');
      getBridge()?.switchAppSpace('en', 'enAtelier');
    });

    $('sqCanvas')?.addEventListener('click', (evt) => {
      if (!sqState.running) return;
      const canvas = $('sqCanvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const cx = ((evt.clientX - rect.left) / Math.max(1, rect.width)) * SQ_W;
        const cy = ((evt.clientY - rect.top) / Math.max(1, rect.height)) * SQ_H;
        const hit = sqState.enemies.slice().reverse().find(
          (e) => e._rect && cx >= e._rect.x && cx <= e._rect.x + e._rect.w && cy >= e._rect.y && cy <= e._rect.y + e._rect.h
        );
        if (hit) {
          sqState.focusedId = hit.id;
          if (($('sqRecallSelect')?.value || '') === 'audio_radar') {
            speakActiveAudioTarget(0.92);
          }
          updateSquadronHud();
        }
      }
      $('sqTypeInput')?.focus();
    });

    const handleSquadronShortcuts = (e) => {
      if (enState.currentMode !== 'squadron' || !sqState.running || sqState.finished) return false;
      const st = getBridge()?.getState?.();
      if (!st || st.currentSpace !== 'en' || enState.currentView === 'neuro' || enState.currentView === 'enReader') return false;

      if (e.key === 'Tab') {
        e.preventDefault();
        triggerSquadronRadar();
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        clearSquadronInputAndFocus();
        return true;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        fireSquadronWord();
        return true;
      }
      if (e.altKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault();
        triggerSquadronEmp();
        return true;
      }
      if (e.altKey && (e.code === 'KeyR' || (e.key || '').toLowerCase() === 'r')) {
        e.preventDefault();
        speakActiveAudioTarget(0.9);
        return true;
      }
      return false;
    };

    $('sqTypeInput')?.addEventListener('keydown', (e) => {
      handleSquadronShortcuts(e);
    });

    $('sqTypeInput')?.addEventListener('input', (e) => {
      sqState.draftText = e.target.value || '';
      if (sqState.muzzleError > 0 && sqState.feedbackKind === 'warn') {
        sqState.muzzleError = 0;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (enState.currentMode !== 'squadron' || !sqState.running || sqState.finished) return;
      if (['SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (document.activeElement === $('sqTypeInput')) return;
      if (handleSquadronShortcuts(e)) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && e.key.length === 1 && /^[a-z0-9'\-]$/i.test(e.key)) {
        $('sqTypeInput')?.focus();
      }
    });
  }

  // =========================================================================
  // MODULE 3: ENGLISH DEEP READING STUDIO (#viewEnReader)
  // =========================================================================
  async function ensureReadingsLoaded() {
    if (enReaderState.readingsLoaded) return enReaderState.readings;
    if (enReaderState.readingsLoadingPromise) return enReaderState.readingsLoadingPromise;

    enReaderState.readingsLoadingPromise = (async () => {
      const res = await fetch('data/en-readings.json');
      const data = await res.json();
      enReaderState.readings = Array.isArray(data) ? data : [];
      enReaderState.readingsLoaded = true;
      if (enState.currentView === 'enReader') {
        populateReaderLevelCounts();
      }
      getBridge()?.renderHomeHub?.();
      return enReaderState.readings;
    })();

    return enReaderState.readingsLoadingPromise;
  }

  function getEnReadingStats() {
    const prog = getBridge()?.getProgress?.();
    const doneMap = prog?.enReadingsDone || {};
    const customList = Array.isArray(prog?.enCustomReadings) ? prog.enCustomReadings : [];
    const builtInTotal = enReaderState.readings.length || 15;
    const builtInIds = enReaderState.readingsLoaded
      ? new Set(enReaderState.readings.map((r) => r.id))
      : null;
    let doneBuiltIn = 0;
    Object.keys(doneMap).forEach((id) => {
      if (builtInIds ? builtInIds.has(id) : !String(id).startsWith('en-custom-')) {
        doneBuiltIn += 1;
      }
    });
    return {
      done: doneBuiltIn,
      total: builtInTotal,
      custom: customList.length,
    };
  }

  function getReadingTitleById(id) {
    const prog = getBridge()?.getProgress?.();
    const customList = Array.isArray(prog?.enCustomReadings) ? prog.enCustomReadings : [];
    const cHit = customList.find((r) => r.id === id);
    if (cHit?.title) return cHit.title;
    const rHit = enReaderState.readings.find((r) => r.id === id);
    if (rHit?.title) return rHit.title;
    return '';
  }

  function getAllEnReadings() {
    const prog = getBridge()?.getProgress?.();
    const customList = Array.isArray(prog?.enCustomReadings) ? prog.enCustomReadings : [];
    return [...customList, ...enReaderState.readings];
  }

  function isEnReadingDone(id) {
    const prog = getBridge()?.getProgress?.();
    return Boolean(prog?.enReadingsDone && Object.hasOwn(prog.enReadingsDone, id));
  }

  function syncEnReaderFilterChips() {
    qsa('#viewEnReader .en-reader-filter').forEach((b) => {
      b.classList.toggle('active', b.dataset.enfilter === enReaderState.filter);
    });
  }

  function getFilteredEnReadings() {
    const all = getAllEnReadings();
    const filter = enReaderState.filter || 'all';
    const q = (enReaderState.searchQuery || '').trim().toLowerCase();

    let pool;
    if (filter === 'custom') {
      pool = all.filter((r) => String(r.id).startsWith('en-custom-'));
    } else {
      pool = all.filter((r) => (r.level || 'A1') === enReaderState.currentLevel);
      if (filter === 'done') pool = pool.filter((r) => isEnReadingDone(r.id));
      else if (filter === 'unread') pool = pool.filter((r) => !isEnReadingDone(r.id));
    }

    if (!q) return pool;
    return pool.filter((r) => {
      if ((r.title || '').toLowerCase().includes(q)) return true;
      if ((r.category || '').toLowerCase().includes(q)) return true;
      if ((r.source || '').toLowerCase().includes(q)) return true;
      return (r.paragraphs || []).some((p) => (p.en || '').toLowerCase().includes(q));
    });
  }

  function updateEnReaderNavButtons(filteredList) {
    const list = filteredList || getFilteredEnReadings();
    const curId = enReaderState.currentReading?.id;
    const idx = curId ? list.findIndex((r) => r.id === curId) : -1;
    if ($('enReaderPrevBtn')) $('enReaderPrevBtn').disabled = idx <= 0;
    if ($('enReaderNextBtn')) $('enReaderNextBtn').disabled = idx === -1 || idx >= list.length - 1;
  }

  function renderEnReaderList(autoPick = false) {
    const listEl = $('enReaderList');
    if (!listEl) return;

    populateReaderLevelCounts();
    const filtered = getFilteredEnReadings();
    const scopeText = enReaderState.filter === 'custom'
      ? `Tự dán: ${filtered.length} bài đọc`
      : `CEFR ${enReaderState.currentLevel}: ${filtered.length} bài đọc`;
    if ($('enReaderListMeta')) $('enReaderListMeta').textContent = scopeText;

    listEl.innerHTML = '';
    if (!filtered.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'rk-empty';
      emptyEl.textContent = 'Không có bài đọc khớp bộ lọc. Hãy chọn cấp độ CEFR khác hoặc bấm "+ Dán bài viết tiếng Anh bất kỳ".';
      listEl.appendChild(emptyEl);
      updateEnReaderNavButtons(filtered);
      return;
    }

    filtered.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kanji-item';
      btn.dataset.readingId = r.id;
      if (enReaderState.currentReading && enReaderState.currentReading.id === r.id) {
        btn.classList.add('active');
      }
      const isCustom = String(r.id).startsWith('en-custom-');
      const done = isEnReadingDone(r.id);
      const badgeText = isCustom ? `${r.level || 'B1'}·Tự` : (r.level || 'A1');
      btn.innerHTML = `
        <span class="en-reader-lvl-badge${isCustom ? ' is-custom' : ''}">${escapeHtml(badgeText)}</span>
        <span class="kanji-item-body">
          <div class="kanji-item-hv">${escapeHtml(r.title)}</div>
          <div class="kanji-item-vi">${escapeHtml((r.paragraphs || []).length)} đoạn · ${escapeHtml(r.category || 'Deep Focus')}</div>
        </span>
        <span class="kanji-item-dot${done ? ' mastered' : ''}"></span>
      `;
      btn.addEventListener('click', () => selectEnReading(r));
      listEl.appendChild(btn);
    });

    const stillInFiltered = enReaderState.currentReading && filtered.some((r) => r.id === enReaderState.currentReading.id);
    if (autoPick || (!enReaderState.currentReading && filtered.length) || (!stillInFiltered && autoPick)) {
      selectEnReading(filtered[0]);
    } else {
      updateEnReaderNavButtons(filtered);
    }
  }

  function selectEnReading(reading) {
    if (!reading) return;
    window.MediaCoach?.pauseAll?.();
    window.speechSynthesis?.cancel?.();

    $('enCustomReadingForm')?.classList.add('hidden');
    $('enReaderArticleWrap')?.classList.remove('hidden');

    enReaderState.currentReading = reading;
    enReaderState.unlockedIdx = 0;
    enReaderState.allUnlocked = enReaderState.mode === 'full';
    enReaderState.activeParaIdx = 0;
    enReaderState.paraTransOpen = Object.create(null);
    enReaderState.selectedToken = null;
    enReaderState.lookupSeq += 1;

    qsa('#enReaderList .kanji-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.readingId === reading.id);
    });

    if ($('enReaderLevelTag')) $('enReaderLevelTag').textContent = `CEFR ${reading.level || 'A1'}`;
    if ($('enReaderCategoryTag')) $('enReaderCategoryTag').textContent = reading.category || 'Deep Focus';
    if ($('enReaderSourceTag')) $('enReaderSourceTag').textContent = reading.source || '';
    if ($('enReaderTitle')) $('enReaderTitle').textContent = reading.title || '';

    if ($('enReaderModeToggleBtn')) {
      $('enReaderModeToggleBtn').textContent = enReaderState.mode === 'full' ? 'Chế độ: Toàn bài' : 'Chế độ: Từng đoạn';
    }
    if ($('enReaderTransAllBtn')) {
      $('enReaderTransAllBtn').textContent = enReaderState.showAllTrans ? 'Ẩn dịch Việt' : 'Hiện dịch Việt';
    }

    renderEnReaderParagraphs();
    renderEnReaderQuestionAndSummary();
    updateEnReaderNavButtons();
  }

  function isTokenKeywordOrCore(cleanedTok, para) {
    const cands = lemmatizeCandidates(cleanedTok);
    const kws = Array.isArray(para?.keyWords) ? para.keyWords : [];
    for (const kw of kws) {
      const kwW = String(kw.w || '').trim().toLowerCase();
      if (kwW && cands.includes(kwW)) return kwW;
    }
    for (const c of cands) {
      if (enState.vocabByWord[c]) return c;
    }
    return '';
  }

  function isTokenSrsDue(cleanedTok, baseGuess) {
    if (getWordStatus(cleanedTok) === 'due') return true;
    if (baseGuess && getWordStatus(baseGuess) === 'due') return true;
    const cands = lemmatizeCandidates(cleanedTok);
    return cands.some((c) => getWordStatus(c) === 'due');
  }

  function refreshReaderTokenSrsMarks() {
    qsa('#enReaderParagraphs .en-word-token').forEach((tokBtn) => {
      const raw = tokBtn.dataset.word || '';
      const base = tokBtn.dataset.baseWord || '';
      tokBtn.classList.toggle('is-srs-due', isTokenSrsDue(raw, base));
    });
  }

  function resolveReaderWord(rawToken, para) {
    const cleaned = String(rawToken || '')
      .trim()
      .toLowerCase()
      .replace(/’/g, "'")
      .replace(/^[^a-z]+|[^a-z]+$/g, '');
    const cands = lemmatizeCandidates(cleaned);
    const kws = Array.isArray(para?.keyWords) ? para.keyWords : [];

    let kwHit = null;
    for (const c of cands) {
      kwHit = kws.find((k) => String(k.w || '').trim().toLowerCase() === c) || null;
      if (kwHit) break;
    }

    let vocabHit = null;
    if (kwHit) {
      const kwBase = String(kwHit.w || '').trim().toLowerCase();
      vocabHit = enState.vocabByWord[kwBase] || null;
    }
    if (!vocabHit) {
      for (const c of cands) {
        if (enState.vocabByWord[c]) {
          vocabHit = enState.vocabByWord[c];
          break;
        }
      }
    }

    let t10kHit = null;
    if (!vocabHit && enState.top10kLoaded) {
      for (const c of cands) {
        if (enState.top10kByWord[c]) {
          t10kHit = enState.top10kByWord[c];
          break;
        }
      }
    }

    const baseWord = vocabHit?.w || (kwHit ? String(kwHit.w).trim().toLowerCase() : '') || t10kHit?.w || cands[0] || cleaned;
    const cached = enState.lookupCache[baseWord] || enState.lookupCache[cleaned] || null;
    const recMeta = getEnRecord(baseWord)?.meta || getEnRecord(cleaned)?.meta || null;
    const auto = (!vocabHit && !t10kHit) ? autoSegment(baseWord) : null;

    const rootId = vocabHit?.rootId || kwHit?.rootId || t10kHit?.rootId || recMeta?.rootId || auto?.rootId || '';
    const parts = (Array.isArray(vocabHit?.parts) && vocabHit.parts.length)
      ? vocabHit.parts
      : (Array.isArray(t10kHit?.autoParts) && t10kHit.autoParts.length)
        ? t10kHit.autoParts
        : (Array.isArray(recMeta?.parts) && recMeta.parts.length)
          ? recMeta.parts
          : (auto?.parts?.length ? auto.parts : [{ type: 'root', text: baseWord, meaningVi: 'gốc từ nguyên khối' }]);

    const ipa = vocabHit?.ipa || kwHit?.ipa || cached?.ipa || recMeta?.ipa || '';
    const pos = vocabHit?.pos || cached?.pos || recMeta?.pos || (t10kHit ? 'corpus 10k' : 'word');
    const vi = vocabHit?.vi || kwHit?.vi || cached?.vi || recMeta?.vi || '';
    const enDef = vocabHit?.enDef || cached?.enDef || recMeta?.enDef || '';
    const exampleEn = vocabHit?.exampleEn || cached?.exampleEn || recMeta?.exampleEn || '';
    const lvl = vocabHit?.lvl || t10kHit?.lvl || recMeta?.lvl || enReaderState.currentReading?.level || 'B1';

    return {
      word: baseWord,
      surfaceWord: cleaned,
      isInflected: Boolean(baseWord && cleaned && baseWord !== cleaned),
      lvl,
      rank: vocabHit?.rank || t10kHit?.rank || 9999,
      ipa,
      pos,
      vi,
      enDef,
      exampleEn,
      rootId,
      parts,
      needsLookup: !vocabHit && !kwHit && !cached,
    };
  }

  function renderMorphBlocksInto(eqBox, resolved) {
    eqBox.innerHTML = '';
    const parts = Array.isArray(resolved.parts) && resolved.parts.length
      ? resolved.parts
      : [{ type: 'root', text: resolved.word, meaningVi: resolved.vi || 'gốc từ nguyên khối' }];
    parts.forEach((part, idx) => {
      if (idx > 0) {
        const op = document.createElement('div');
        op.className = 'morph-op';
        op.textContent = '+';
        eqBox.appendChild(op);
      }
      const block = document.createElement('div');
      block.className = `morph-block ${part.type || 'root'}`;

      const tagEl = document.createElement('div');
      tagEl.className = 'morph-block-tag';
      tagEl.textContent = { prefix: 'Tiền tố (Prefix)', root: 'Gốc từ (Root)', suffix: 'Hậu tố (Suffix)' }[part.type] || 'Thành tố';

      const textEl = document.createElement('div');
      textEl.className = 'morph-block-text';
      textEl.textContent = part.text || '';

      const viEl = document.createElement('div');
      viEl.className = 'morph-block-vi';
      viEl.textContent = part.meaningVi || '—';

      block.appendChild(tagEl);
      block.appendChild(textEl);
      block.appendChild(viEl);
      eqBox.appendChild(block);
    });
  }

  async function openInlineWordInspector(paraIdx, tokenIdx, rawWord, para, cardEl, paraEnEl, tokBtn) {
    window.MediaCoach?.pauseAll?.();
    const prevIns = $('enInlineInspector');
    if (prevIns) prevIns.remove();

    qsa('#enReaderParagraphs .en-word-token.is-selected').forEach((b) => b.classList.remove('is-selected'));
    tokBtn.classList.add('is-selected');

    if (enReaderState.allUnlocked) {
      enReaderState.activeParaIdx = paraIdx;
      qsa('#enReaderParagraphs .para-card').forEach((c, i) => c.classList.toggle('active', i === paraIdx));
    }

    const resolved = resolveReaderWord(rawWord, para);
    enReaderState.selectedToken = { paraIdx, tokenIdx, rawWord, targetWord: resolved.word, resolved };

    const inspector = document.createElement('div');
    inspector.id = 'enInlineInspector';
    inspector.className = 'en-inline-inspector';

    // Header
    const head = document.createElement('div');
    head.className = 'en-inline-inspector-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'en-inline-inspector-title';

    const wordSpan = document.createElement('span');
    wordSpan.className = 'en-inline-word';
    wordSpan.textContent = resolved.isInflected ? `${resolved.word} (${resolved.surfaceWord})` : resolved.word;

    const ipaSpan = document.createElement('span');
    ipaSpan.className = 'en-inline-ipa';
    ipaSpan.textContent = resolved.ipa || `/${resolved.word}/`;

    const posSpan = document.createElement('span');
    posSpan.className = 'en-inline-pos';
    posSpan.textContent = resolved.pos || 'word';

    const lvlSpan = document.createElement('span');
    lvlSpan.className = 'prompt-jlpt-tag';
    lvlSpan.textContent = `CEFR ${resolved.lvl || 'A1'}`;

    titleWrap.appendChild(wordSpan);
    titleWrap.appendChild(ipaSpan);
    titleWrap.appendChild(posSpan);
    titleWrap.appendChild(lvlSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-ghost-sm';
    closeBtn.title = 'Đóng bảng giải phẫu';
    closeBtn.textContent = '✕ Đóng';
    closeBtn.addEventListener('click', () => {
      window.MediaCoach?.pauseAll?.();
      inspector.remove();
      tokBtn.classList.remove('is-selected');
      enReaderState.selectedToken = null;
    });

    head.appendChild(titleWrap);
    head.appendChild(closeBtn);
    inspector.appendChild(head);

    // Meaning & Definition
    const meaningBox = document.createElement('div');
    const viDiv = document.createElement('div');
    viDiv.className = 'en-inline-meaning';
    viDiv.textContent = resolved.vi || (resolved.needsLookup ? 'Đang tra cứu nghĩa Tiếng Việt...' : 'Chưa có nghĩa trực tuyến');

    const defDiv = document.createElement('div');
    defDiv.className = 'en-inline-def';
    defDiv.textContent = resolved.enDef || '';

    meaningBox.appendChild(viDiv);
    meaningBox.appendChild(defDiv);
    inspector.appendChild(meaningBox);

    // Morphology Equation
    const eqBox = document.createElement('div');
    eqBox.className = 'morph-equation';
    renderMorphBlocksInto(eqBox, resolved);
    inspector.appendChild(eqBox);

    const rootHint = document.createElement('div');
    rootHint.className = 'sub-hint';
    const updateRootHint = () => {
      const rInfo = resolved.rootId ? enState.rootsById[resolved.rootId] : null;
      if (rInfo) {
        rootHint.textContent = `Gốc ${rInfo.root} (${rInfo.origin}): ${rInfo.meaningVi}`;
        rootHint.classList.remove('hidden');
      } else {
        rootHint.textContent = '';
        rootHint.classList.add('hidden');
      }
    };
    updateRootHint();
    inspector.appendChild(rootHint);

    // Audio & MediaCoach controls
    const audioRow = document.createElement('div');
    audioRow.className = 'en-inline-inspector-audio';

    const makeAudioBtn = (label, handler) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-ghost-sm';
      b.textContent = label;
      b.addEventListener('click', handler);
      return b;
    };

    audioRow.appendChild(makeAudioBtn('🔊 US 1.0x', () => speakEnglish(resolved.word, 'en-US', 1.0)));
    audioRow.appendChild(makeAudioBtn('🐢 US 0.75x', () => speakEnglish(resolved.word, 'en-US', 0.75)));
    audioRow.appendChild(makeAudioBtn('🔊 UK 1.0x', () => speakEnglish(resolved.word, 'en-GB', 1.0)));
    audioRow.appendChild(makeAudioBtn('🐢 UK 0.75x', () => speakEnglish(resolved.word, 'en-GB', 0.75)));
    audioRow.appendChild(makeAudioBtn('🎬 YouGlish', () => {
      window.MediaCoach?.openYouGlish(resolved.word, 'english', '', 'enReaderMediaCoachMount');
    }));
    audioRow.appendChild(makeAudioBtn('🎙️ Đọc thử', () => {
      window.MediaCoach?.openMicCoach({
        word: resolved.word,
        sentence: para.en || resolved.exampleEn || '',
        lang: 'en-US',
        mountId: 'enReaderMediaCoachMount',
      });
    }));
    inspector.appendChild(audioRow);

    // MediaCoach mount inside inspector
    const coachMount = document.createElement('div');
    coachMount.id = 'enReaderMediaCoachMount';
    inspector.appendChild(coachMount);

    // Actions row: + Đưa vào SRS Hôm nay & Mở trong Xưởng Gốc Từ ->
    const actionsRow = document.createElement('div');
    actionsRow.className = 'en-inline-inspector-actions';

    const srsBtn = document.createElement('button');
    srsBtn.type = 'button';
    srsBtn.className = 'btn-primary-sm';
    const syncSrsBtnState = () => {
      const existing = getEnRecord(resolved.word);
      if (existing) {
        srsBtn.textContent = '✓ Đã đưa vào SRS';
        srsBtn.disabled = true;
      } else {
        srsBtn.textContent = '+ Đưa vào SRS Hôm nay';
        srsBtn.disabled = false;
      }
    };
    syncSrsBtnState();
    srsBtn.addEventListener('click', () => {
      const bridge = getBridge();
      const map = getEnProgressMap();
      if (Object.hasOwn(map, resolved.word)) {
        syncSrsBtnState();
        return;
      }
      const nowIso = new Date().toISOString();
      const record = {
        reps: 0,
        interval: 0,
        ease: 2.5,
        writePasses: 0,
        blindPasses: 0,
        note: '',
        due: nowIso,
      };
      if (!enState.vocabByWord[resolved.word]) {
        record.meta = {
          lvl: resolved.lvl || 'B1',
          ipa: resolved.ipa || `/${resolved.word}/`,
          pos: resolved.pos || 'word',
          vi: resolved.vi || '',
          enDef: resolved.enDef || '',
          rootId: resolved.rootId || '',
          parts: Array.isArray(resolved.parts) ? resolved.parts : [],
        };
      }
      map[resolved.word] = record;
      bridge?.saveProgress?.(true);
      bridge?.updateDueBadges?.();
      updateTodayBadge();
      bridge?.renderHomeHub?.();
      syncSrsBtnState();
      refreshReaderTokenSrsMarks();
    });

    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.className = 'btn-ghost-sm';
    jumpBtn.textContent = 'Mở trong Xưởng Gốc Từ →';
    jumpBtn.addEventListener('click', () => {
      window.EnAtelierApp.jumpToWord(resolved.word, resolved);
    });

    actionsRow.appendChild(srsBtn);
    actionsRow.appendChild(jumpBtn);
    inspector.appendChild(actionsRow);

    paraEnEl.insertAdjacentElement('afterend', inspector);

    if (resolved.needsLookup) {
      const seq = ++enReaderState.lookupSeq;
      try {
        if (!enState.top10kLoaded) {
          await ensureTop10kLoaded().catch(() => {});
          if (seq !== enReaderState.lookupSeq || !document.body.contains(inspector)) return;
          const tHit = enState.top10kByWord[resolved.word];
          if (tHit) {
            resolved.lvl = tHit.lvl || resolved.lvl;
            resolved.rank = tHit.rank || resolved.rank;
            if (tHit.rootId && !resolved.rootId) resolved.rootId = tHit.rootId;
            if (Array.isArray(tHit.autoParts) && tHit.autoParts.length) {
              resolved.parts = tHit.autoParts;
              renderMorphBlocksInto(eqBox, resolved);
            }
            lvlSpan.textContent = `CEFR ${resolved.lvl}`;
            updateRootHint();
          }
        }

        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        const fetchTimer = ac ? setTimeout(() => ac.abort(), 4500) : null;
        let res;
        try {
          res = await fetch(
            `/api/en-lookup?word=${encodeURIComponent(resolved.word)}`,
            ac ? { signal: ac.signal } : undefined
          );
        } finally {
          if (fetchTimer) clearTimeout(fetchTimer);
        }
        if (seq !== enReaderState.lookupSeq || !document.body.contains(inspector)) return;
        if (res.ok) {
          const data = await res.json();
          if (seq !== enReaderState.lookupSeq || !document.body.contains(inspector)) return;
          if (data && data.ok) {
            const enriched = {
              ipa: data.ipa || resolved.ipa || `/${resolved.word}/`,
              pos: data.pos || resolved.pos || 'word',
              vi: data.vi || 'Chưa có nghĩa trực tuyến',
              enDef: data.enDef || '',
              exampleEn: data.exampleEn || '',
            };
            if (data.found && !data.offline) {
              enState.lookupCache[resolved.word] = enriched;
            }
            resolved.ipa = enriched.ipa;
            resolved.pos = enriched.pos;
            resolved.vi = enriched.vi;
            resolved.enDef = enriched.enDef;
            resolved.exampleEn = enriched.exampleEn;

            ipaSpan.textContent = resolved.ipa;
            posSpan.textContent = resolved.pos;
            viDiv.textContent = resolved.vi;
            defDiv.textContent = resolved.enDef;

            // If user already enqueued while lookup was in flight, update stored meta cleanly
            const existingRec = getEnRecord(resolved.word);
            if (existingRec && existingRec.meta && data.found && !data.offline) {
              existingRec.meta.ipa = resolved.ipa;
              existingRec.meta.pos = resolved.pos;
              existingRec.meta.vi = resolved.vi;
              existingRec.meta.enDef = resolved.enDef;
              getBridge()?.saveProgress?.(true);
            }
          }
        } else {
          viDiv.textContent = 'Chưa có nghĩa trực tuyến (đã giữ phân tích gốc từ)';
        }
      } catch (_) {
        if (seq === enReaderState.lookupSeq && document.body.contains(inspector)) {
          viDiv.textContent = 'Không kết nối được từ điển trực tuyến (đã giữ phân tích gốc từ)';
        }
      }
    }
  }

  function renderEnReaderParagraphs() {
    const reading = enReaderState.currentReading;
    const container = $('enReaderParagraphs');
    if (!container) return;

    window.MediaCoach?.pauseAll?.();
    container.innerHTML = '';
    if (!reading) return;

    const paras = Array.isArray(reading.paragraphs) ? reading.paragraphs : [];
    const activeTargetIdx = enReaderState.allUnlocked ? enReaderState.activeParaIdx : enReaderState.unlockedIdx;

    paras.forEach((para, idx) => {
      const isLocked = enReaderState.mode === 'paragraph' && !enReaderState.allUnlocked && idx > enReaderState.unlockedIdx;
      const isActive = !isLocked && idx === activeTargetIdx;

      const card = document.createElement('article');
      card.className = `para-card${isActive ? ' active' : ''}${isLocked ? ' blurred' : ''}`;

      const head = document.createElement('div');
      head.className = 'para-head';
      const headLeft = document.createElement('span');
      headLeft.className = 'mono';
      headLeft.textContent = `Đoạn ${idx + 1} / ${paras.length}`;
      const headRight = document.createElement('span');
      headRight.textContent = isLocked ? 'Đang khóa chống đọc lướt' : (isActive ? 'Đoạn đang đọc' : 'Đã mở');
      head.appendChild(headLeft);
      head.appendChild(headRight);
      card.appendChild(head);

      const enDiv = document.createElement('div');
      enDiv.className = 'para-en';

      const text = String(para.en || '');
      const tokenRegex = /([A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*)/g;
      let lastIdx = 0;
      let tokCounter = 0;
      let match;
      while ((match = tokenRegex.exec(text)) !== null) {
        if (match.index > lastIdx) {
          enDiv.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        }
        const tok = match[1];
        const cleanTok = tok.toLowerCase().replace(/’/g, "'");
        const baseMatch = isTokenKeywordOrCore(cleanTok, para);

        const tokBtn = document.createElement('button');
        tokBtn.type = 'button';
        tokBtn.className = 'en-word-token';
        if (baseMatch) tokBtn.classList.add('is-keyword');
        if (isTokenSrsDue(cleanTok, baseMatch)) tokBtn.classList.add('is-srs-due');
        tokBtn.textContent = tok;
        tokBtn.dataset.word = cleanTok;
        if (baseMatch) tokBtn.dataset.baseWord = baseMatch;

        const curTokIdx = tokCounter++;
        if (!isLocked) {
          tokBtn.addEventListener('click', () => {
            openInlineWordInspector(idx, curTokIdx, tok, para, card, enDiv, tokBtn);
          });
        }
        enDiv.appendChild(tokBtn);
        lastIdx = tokenRegex.lastIndex;
      }
      if (lastIdx < text.length) {
        enDiv.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      card.appendChild(enDiv);

      if (!isLocked) {
        let viDiv = null;
        if (para.vi) {
          viDiv = document.createElement('div');
          const showVi = enReaderState.showAllTrans || Boolean(enReaderState.paraTransOpen[idx]);
          viDiv.className = `para-vi${showVi ? '' : ' hidden'}`;
          viDiv.textContent = para.vi;
        }

        const actions = document.createElement('div');
        actions.className = 'para-actions';

        const leftBtns = document.createElement('div');
        leftBtns.style.display = 'flex';
        leftBtns.style.flexWrap = 'wrap';
        leftBtns.style.gap = '6px';

        const speakParaBtn = document.createElement('button');
        speakParaBtn.type = 'button';
        speakParaBtn.className = 'btn-ghost-sm';
        speakParaBtn.textContent = '🔊 Nghe đoạn này';
        speakParaBtn.addEventListener('click', () => speakEnglish(para.en, 'en-US', 0.94));
        leftBtns.appendChild(speakParaBtn);

        if (viDiv) {
          const transBtn = document.createElement('button');
          transBtn.type = 'button';
          transBtn.className = 'btn-ghost-sm';
          const isOpen = enReaderState.showAllTrans || Boolean(enReaderState.paraTransOpen[idx]);
          transBtn.textContent = isOpen ? 'Ẩn dịch' : 'Xem dịch đối chiếu';
          transBtn.addEventListener('click', () => {
            const next = viDiv.classList.toggle('hidden');
            enReaderState.paraTransOpen[idx] = !next;
            transBtn.textContent = next ? 'Xem dịch đối chiếu' : 'Ẩn dịch';
          });
          leftBtns.appendChild(transBtn);
        }

        actions.appendChild(leftBtns);

        if (enReaderState.mode === 'paragraph' && !enReaderState.allUnlocked && idx === enReaderState.unlockedIdx) {
          const isLast = idx === paras.length - 1;
          const nextBtn = document.createElement('button');
          nextBtn.type = 'button';
          nextBtn.className = 'btn-primary-sm';
          nextBtn.textContent = isLast ? 'Mở câu hỏi & Tóm tắt →' : 'Đã hiểu đoạn này → Mở đoạn tiếp';
          nextBtn.addEventListener('click', () => {
            if (isLast) {
              enReaderState.allUnlocked = true;
              enReaderState.activeParaIdx = idx;
            } else {
              enReaderState.unlockedIdx += 1;
              enReaderState.activeParaIdx = enReaderState.unlockedIdx;
            }
            renderEnReaderParagraphs();
            renderEnReaderQuestionAndSummary();
          });
          actions.appendChild(nextBtn);
        }

        card.appendChild(actions);
        if (viDiv) card.appendChild(viDiv);
      }

      container.appendChild(card);
    });
  }

  function renderEnReaderQuestionAndSummary() {
    const reading = enReaderState.currentReading;
    const qBox = $('enReaderQuestionBox');
    const sBox = $('enReaderSummaryBox');
    const unlocked = Boolean(reading && (enReaderState.mode === 'full' || enReaderState.allUnlocked));

    if (reading) {
      const prog = getBridge()?.getProgress?.();
      const doneRec = prog?.enReadingsDone?.[reading.id];
      const noteRec = prog?.enReadingNotes?.[reading.id];
      const existingSummary = noteRec?.summary ?? doneRec?.summary ?? '';
      if ($('enReaderSummaryInput')) $('enReaderSummaryInput').value = existingSummary;
      if ($('enReaderDoneBadge')) {
        $('enReaderDoneBadge').textContent = doneRec ? '✓ Đã hoàn thành' : 'Chưa hoàn thành';
      }
    }

    if (!unlocked) {
      qBox?.classList.add('hidden');
      sBox?.classList.add('hidden');
      return;
    }

    if (qBox) {
      qBox.classList.remove('hidden');
      qBox.innerHTML = '';
      const q = reading.question || {};
      const pEn = document.createElement('div');
      pEn.className = 'en-question-prompt-en';
      pEn.textContent = q.promptEn || 'Write a 1-sentence summary of this article in your own words.';
      qBox.appendChild(pEn);

      const pVi = document.createElement('div');
      pVi.className = 'en-question-prompt-vi';
      pVi.textContent = q.promptVi || 'Viết 1 câu tóm tắt ý chính của bài viết bằng tiếng Anh.';
      qBox.appendChild(pVi);

      if (q.sampleAnswer) {
        const sampleDiv = document.createElement('div');
        sampleDiv.className = 'en-question-sample hidden';
        sampleDiv.textContent = q.sampleAnswer;

        const revealBtn = document.createElement('button');
        revealBtn.type = 'button';
        revealBtn.className = 'btn-ghost-sm';
        revealBtn.textContent = 'Xem gợi ý trả lời mẫu';
        revealBtn.addEventListener('click', () => {
          const nowHidden = sampleDiv.classList.toggle('hidden');
          revealBtn.textContent = nowHidden ? 'Xem gợi ý trả lời mẫu' : 'Ẩn gợi ý trả lời mẫu';
        });
        qBox.appendChild(revealBtn);
        qBox.appendChild(sampleDiv);
      }
    }

    if (sBox) {
      sBox.classList.remove('hidden');
    }
  }

  function navigateEnReading(delta) {
    const list = getFilteredEnReadings();
    if (!list.length) return;
    const curId = enReaderState.currentReading?.id;
    const idx = curId ? list.findIndex((r) => r.id === curId) : -1;
    const nextIdx = idx === -1 ? 0 : Math.max(0, Math.min(list.length - 1, idx + delta));
    if (nextIdx !== idx && list[nextIdx]) {
      selectEnReading(list[nextIdx]);
    }
  }

  function bindEnReaderEvents() {
    $('enReaderToggleSidebarBtn')?.addEventListener('click', () => {
      const ws = $('viewEnReader');
      const btn = $('enReaderToggleSidebarBtn');
      if (!ws || !btn) return;
      const collapsed = ws.classList.toggle('sidebar-collapsed');
      btn.textContent = collapsed ? '▶ Danh sách' : '◀ Danh sách';
    });

    $('enReaderModeToggleBtn')?.addEventListener('click', () => {
      enReaderState.mode = enReaderState.mode === 'paragraph' ? 'full' : 'paragraph';
      if (enReaderState.mode === 'full') {
        enReaderState.allUnlocked = true;
      } else {
        enReaderState.allUnlocked = false;
        enReaderState.unlockedIdx = 0;
        enReaderState.activeParaIdx = 0;
      }
      if ($('enReaderModeToggleBtn')) {
        $('enReaderModeToggleBtn').textContent = enReaderState.mode === 'full' ? 'Chế độ: Toàn bài' : 'Chế độ: Từng đoạn';
      }
      renderEnReaderParagraphs();
      renderEnReaderQuestionAndSummary();
    });

    $('enReaderTransAllBtn')?.addEventListener('click', () => {
      enReaderState.showAllTrans = !enReaderState.showAllTrans;
      if ($('enReaderTransAllBtn')) {
        $('enReaderTransAllBtn').textContent = enReaderState.showAllTrans ? 'Ẩn dịch Việt' : 'Hiện dịch Việt';
      }
      qsa('#enReaderParagraphs .para-vi').forEach((el) => {
        el.classList.toggle('hidden', !enReaderState.showAllTrans);
      });
      if (!enReaderState.showAllTrans) {
        enReaderState.paraTransOpen = Object.create(null);
      }
      qsa('#enReaderParagraphs .para-actions button').forEach((btn) => {
        if (btn.textContent === 'Xem dịch đối chiếu' || btn.textContent === 'Ẩn dịch') {
          btn.textContent = enReaderState.showAllTrans ? 'Ẩn dịch' : 'Xem dịch đối chiếu';
        }
      });
    });

    $('enReaderPrevBtn')?.addEventListener('click', () => navigateEnReading(-1));
    $('enReaderNextBtn')?.addEventListener('click', () => navigateEnReading(1));

    $('enReaderSearchInput')?.addEventListener('input', (e) => {
      enReaderState.searchQuery = e.target.value || '';
      renderEnReaderList(false);
    });

    qsa('#viewEnReader .en-reader-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        enReaderState.filter = btn.dataset.enfilter || 'all';
        syncEnReaderFilterChips();
        renderEnReaderList(true);
      });
    });

    $('enReaderSpeakUsBtn')?.addEventListener('click', () => {
      const r = enReaderState.currentReading;
      if (!r) return;
      const fullText = (r.paragraphs || []).map((p) => p.en).join('. ');
      speakEnglish(fullText, 'en-US', 1.0);
    });

    $('enReaderSpeakSlowBtn')?.addEventListener('click', () => {
      const r = enReaderState.currentReading;
      if (!r) return;
      const fullText = (r.paragraphs || []).map((p) => p.en).join('. ');
      speakEnglish(fullText, 'en-US', 0.75);
    });

    $('enReaderResetBtn')?.addEventListener('click', () => {
      if (!enReaderState.currentReading) return;
      window.speechSynthesis?.cancel?.();
      window.MediaCoach?.pauseAll?.();
      enReaderState.mode = 'paragraph';
      enReaderState.unlockedIdx = 0;
      enReaderState.allUnlocked = false;
      enReaderState.activeParaIdx = 0;
      enReaderState.showAllTrans = false;
      enReaderState.paraTransOpen = Object.create(null);
      enReaderState.selectedToken = null;
      if ($('enReaderModeToggleBtn')) $('enReaderModeToggleBtn').textContent = 'Chế độ: Từng đoạn';
      if ($('enReaderTransAllBtn')) $('enReaderTransAllBtn').textContent = 'Hiện dịch Việt';
      renderEnReaderParagraphs();
      renderEnReaderQuestionAndSummary();
    });

    $('openEnCustomReadingBtn')?.addEventListener('click', () => {
      $('enCustomReadingForm')?.classList.remove('hidden');
      $('enReaderArticleWrap')?.classList.add('hidden');
      $('enCustomTitle')?.focus();
    });

    $('enCustomCancelBtn')?.addEventListener('click', () => {
      $('enCustomReadingForm')?.classList.add('hidden');
      $('enReaderArticleWrap')?.classList.remove('hidden');
    });

    $('enCustomReadingForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = ($('enCustomTitle')?.value || '').trim();
      const level = $('enCustomLevel')?.value || 'B1';
      const body = ($('enCustomBody')?.value || '').trim();
      if (!title || !body) return;

      let rawParas = body.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
      if (rawParas.length <= 1) {
        const byLine = body.split(/\n+/).map((s) => s.trim()).filter(Boolean);
        if (byLine.length > 1) rawParas = byLine;
      }
      if (!rawParas.length) return;

      await ensureReadingsLoaded().catch(() => {});
      const bridge = getBridge();
      const prog = bridge?.getProgress?.();
      if (!prog) return;
      if (!Array.isArray(prog.enCustomReadings)) prog.enCustomReadings = [];

      const newReading = {
        id: `en-custom-${Date.now()}`,
        level: CEFR_LEVELS.includes(level) ? level : 'B1',
        title,
        source: 'Bài đọc tự nhập (Cá nhân)',
        category: 'Tự nhập',
        createdAt: new Date().toISOString(),
        paragraphs: rawParas.map((en) => ({ en, vi: '', keyWords: [] })),
        question: {
          promptEn: 'Write a 1-sentence summary of this article in your own words.',
          promptVi: 'Viết 1 câu tóm tắt ý chính của bài viết bằng tiếng Anh.',
          sampleAnswer: '',
        },
      };

      prog.enCustomReadings.unshift(newReading);
      bridge.saveProgress(true);

      if ($('enCustomTitle')) $('enCustomTitle').value = '';
      if ($('enCustomBody')) $('enCustomBody').value = '';
      $('enCustomReadingForm')?.classList.add('hidden');
      $('enReaderArticleWrap')?.classList.remove('hidden');

      enReaderState.currentLevel = newReading.level;
      enState.currentLevel = newReading.level;
      if (enReaderState.filter === 'done') {
        enReaderState.filter = 'all';
        syncEnReaderFilterChips();
      }
      syncLevelButtons();
      enReaderState.currentReading = newReading;
      renderEnReaderList(false);
      selectEnReading(newReading);
      bridge.renderHomeHub?.();
    });

    $('enReaderCompleteBtn')?.addEventListener('click', () => {
      const reading = enReaderState.currentReading;
      const bridge = getBridge();
      const prog = bridge?.getProgress?.();
      if (!reading || !prog) return;

      const summary = ($('enReaderSummaryInput')?.value || '').trim();
      const nowIso = new Date().toISOString();
      if (!prog.enReadingsDone || typeof prog.enReadingsDone !== 'object' || Array.isArray(prog.enReadingsDone)) {
        prog.enReadingsDone = {};
      }
      if (!prog.enReadingNotes || typeof prog.enReadingNotes !== 'object' || Array.isArray(prog.enReadingNotes)) {
        prog.enReadingNotes = {};
      }

      const prevDone = prog.enReadingsDone[reading.id];
      prog.enReadingsDone[reading.id] = {
        completedAt: prevDone?.completedAt || nowIso,
        summary,
      };
      prog.enReadingNotes[reading.id] = {
        summary,
        updatedAt: nowIso,
        title: reading.title || '',
        level: reading.level || 'A1',
      };

      bridge.saveProgress(true);
      if ($('enReaderDoneBadge')) $('enReaderDoneBadge').textContent = '✓ Đã hoàn thành';
      renderEnReaderList(false);
      bridge.renderHomeHub?.();
      bridge.renderNeuroDashboard?.();
    });
  }

  window.EnAtelierApp = {
    getTotalCount: () => enState.vocab.length || 253,
    getRootsCount: () => enState.roots.length || 36,
    renderHomeQuickRoots,
    updateTodayBadge: () => updateTodayBadge(),
    pauseGame: () => pauseSquadronGame(false),
    getSquadronDebugState: () => {
      const recallMode = $('sqRecallSelect')?.value || 'blind_meaning';
      const deckMode = $('sqDeckSelect')?.value || 'learned_today';
      return {
        running: sqState.running,
        paused: sqState.paused,
        finished: sqState.finished,
        wave: sqState.wave,
        deckMode,
        recallMode,
        sessionRecallEligible: sqState.sessionRecallEligible,
        usingFallbackDeck: sqState.usingFallbackDeck,
        score: sqState.score,
        combo: sqState.combo,
        hits: sqState.hits,
        misses: sqState.misses,
        shields: sqState.shields,
        empCharge: sqState.empCharge,
        focusedId: sqState.focusedId,
        feedbackMsg: sqState.feedbackMsg,
        deckPoolKeys: (sqState.deckPool?.words || []).map((x) => x.key),
        deckPhraseLvls: (sqState.deckPool?.phrases || []).map((x) => x.lvl),
        deckSentLvls: (sqState.deckPool?.sentences || []).map((x) => x.lvl),
        cleanKills: Array.from(sqState.cleanKills.keys()),
        missedWords: Array.from(sqState.missedWords.keys()),
        enemies: sqState.enemies.map((e) => {
          const pres = getEnemyCardPresentation(e, recallMode);
          return {
            id: e.id,
            x: e.x,
            y: e.y,
            rect: e._rect,
            isBoss: e.isBoss,
            isElite: e.isElite,
            armorIdx: e.armorIdx,
            armorCount: e.armorStages ? e.armorStages.length : 1,
            armorStages: e.armorStages ? e.armorStages.map((st) => ({
              answerWord: st.answerWord,
              displayCloze: st.displayCloze,
              fullText: st.fullText,
              audioText: st.audioText,
              vi: st.vi,
              lvl: st.lvl,
            })) : null,
            radarLevel: e.radarLevel,
            usedRadar: e.usedRadar,
            revealed: e.revealed,
            clueText: pres.clueText,
            targetText: pres.targetText,
            armorBadge: pres.armorBadge,
            answerWord: pres.stage?.answerWord || '',
            acceptedAnswers: pres.stage?.acceptedAnswers || [],
            audioText: pres.stage?.audioText || '',
            rootId: pres.stage?.rootId || '',
            lvl: pres.stage?.lvl || 'A1',
            isCloze: Boolean(pres.stage?.isCloze),
          };
        }),
      };
    },
    ensureReadingsLoaded,
    getEnReadingStats,
    getReadingTitleById,
    getWordLevel: (word) => {
      const clean = String(word || '').trim().toLowerCase();
      const v = enState.vocabByWord[clean];
      if (v?.lvl) return v.lvl;
      const t = enState.top10kByWord[clean];
      if (t?.lvl) return t.lvl;
      const recMeta = getEnRecord(clean)?.meta;
      return recMeta?.lvl || 'A1';
    },
    getWordMeta: (word) => {
      const clean = String(word || '').trim().toLowerCase();
      const v = enState.vocabByWord[clean];
      if (v) return { w: v.w, lvl: v.lvl, vi: v.vi, ipa: v.ipa, rootId: v.rootId, rank: v.rank };
      const t = enState.top10kByWord[clean];
      const recMeta = getEnRecord(clean)?.meta;
      const cached = enState.lookupCache[clean];
      if (t || recMeta || cached) {
        return {
          w: clean,
          lvl: recMeta?.lvl || t?.lvl || 'B1',
          vi: cached?.vi || recMeta?.vi || '',
          ipa: cached?.ipa || recMeta?.ipa || '',
          rootId: recMeta?.rootId || t?.rootId || '',
          rank: t?.rank || 9999,
        };
      }
      return { w: clean || word, lvl: 'A1', vi: '', ipa: '', rootId: '', rank: 9999 };
    },
    jumpToWord: async (word, optionalMeta = null) => {
      const myJumpSeq = (enState.jumpSeq = (enState.jumpSeq || 0) + 1);
      await ensureEnDataLoaded();
      if (myJumpSeq !== enState.jumpSeq) return;

      const clean = String(word || '').trim().toLowerCase().replace(/[^a-z'-]/g, '');
      const cands = lemmatizeCandidates(clean);

      let found = null;
      for (const c of cands) {
        if (enState.vocabByWord[c]) {
          found = enState.vocabByWord[c];
          break;
        }
      }

      if (!found) {
        await ensureTop10kLoaded().catch(() => {});
        if (myJumpSeq !== enState.jumpSeq) return;
        for (const c of cands) {
          if (enState.top10kByWord[c]) {
            found = makeCorpusStubEntry(enState.top10kByWord[c]);
            break;
          }
        }
      }

      const targetW = found?.w || clean;
      if (!found) {
        const rec = getEnRecord(targetW);
        found = makeEntryFromRecord(targetW, rec);
      }

      if (optionalMeta && found._isCorpusOnly) {
        found = {
          ...found,
          lvl: optionalMeta.lvl || found.lvl,
          ipa: optionalMeta.ipa || found.ipa,
          pos: optionalMeta.pos || found.pos,
          vi: (optionalMeta.vi && optionalMeta.vi !== 'Đang tra cứu nghĩa Tiếng Việt...') ? optionalMeta.vi : found.vi,
          enDef: optionalMeta.enDef || found.enDef,
          exampleEn: optionalMeta.exampleEn || found.exampleEn,
          rootId: optionalMeta.rootId || found.rootId,
          parts: (Array.isArray(optionalMeta.parts) && optionalMeta.parts.length) ? optionalMeta.parts : found.parts,
        };
      }

      if (myJumpSeq !== enState.jumpSeq) return;

      const jumpToken = { entry: found, jumpSeq: myJumpSeq, handled: false };
      enState.currentRootFilter = '';
      if ($('enRootFilterSelect')) $('enRootFilterSelect').value = '';
      enState.currentStatusFilter = 'all';
      syncStatusChips();
      enState.currentLevel = found.lvl || 'A1';
      enState.global10k = Boolean(!enState.vocabByWord[found.w] && enState.top10kByWord[found.w]);
      if ($('enGlobal10kToggle')) $('enGlobal10kToggle').checked = enState.global10k;
      enState.skipNextRestore = true;
      enState._pendingJumpWord = jumpToken;
      enState.currentWord = found;
      saveEnSessionState();

      getBridge()?.switchAppSpace('en', 'enAtelier');
      if (enState._enterSpacePromise) {
        await enState._enterSpacePromise.catch(() => {});
      }
      if (myJumpSeq !== enState.jumpSeq) return;

      if (!jumpToken.handled) {
        if (enState._pendingJumpWord === jumpToken) {
          enState._pendingJumpWord = null;
        }
        if (!enState.currentWord || enState.currentWord.w !== found.w) {
          await selectWord(found);
        }
      } else if (enState.currentWord && enState.currentWord.w !== found.w) {
        return;
      }
      if (myJumpSeq !== enState.jumpSeq) return;

      const idx = enState.filteredList.findIndex((x) => x.w === found.w);
      if (idx >= 0) {
        while (idx >= enState.renderedCount && enState.renderedCount < enState.filteredList.length) {
          renderWordList('append');
        }
      }
      qsa('#enWordList .kanji-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.word === found.w);
      });
      document.querySelector('#enWordList .kanji-item.active')?.scrollIntoView({ block: 'nearest' });
    },
    onEnterSpace: async (targetView) => {
      const myEnterSeq = (enState.enterSpaceSeq = (enState.enterSpaceSeq || 0) + 1);
      const run = (async () => {
        await ensureEnDataLoaded();
        if (myEnterSeq !== enState.enterSpaceSeq) return;
        const s = getBridge()?.getProgress?.()?.settings;

        if (targetView === 'enReader') {
          enState.currentView = 'enReader';
          syncViewTabs('enReader');
          const enLevelTabs = $('enLevelTabs');
          const readerLeft = document.querySelector('#viewEnReader .panel-left');
          if (enLevelTabs && readerLeft && readerLeft.firstElementChild !== enLevelTabs) {
            readerLeft.prepend(enLevelTabs);
          }
          await ensureReadingsLoaded();
          if (myEnterSeq !== enState.enterSpaceSeq) return;
          populateReaderLevelCounts();
          syncLevelButtons();
          renderEnReaderList(!enReaderState.currentReading);
          return;
        }

        if (!enState.sessionRestored && !enState.skipNextRestore && !enState._pendingJumpWord && s) {
          if (s.enLevel && CEFR_LEVELS.includes(s.enLevel)) enState.currentLevel = s.enLevel;
          enState.global10k = Boolean(s.enGlobal10k);
          if (s.enStatusFilter) enState.currentStatusFilter = s.enStatusFilter;
          if (s.enRootFilter !== undefined) enState.currentRootFilter = s.enRootFilter;
          if ($('enGlobal10kToggle')) $('enGlobal10kToggle').checked = enState.global10k;
          if ($('enRootFilterSelect')) $('enRootFilterSelect').value = enState.currentRootFilter;
          syncLevelButtons();
          syncStatusChips();
        }

        const viewMode = targetView === 'enDue' ? 'enDue' : targetView === 'enSquadron' ? 'enSquadron' : 'enAtelier';
        syncViewTabs(viewMode);
        if (viewMode === 'enDue') {
          enState.currentStatusFilter = 'due';
          syncStatusChips();
        }

        if (!enState.top10kLoaded) {
          if (enState.global10k) {
            await ensureTop10kLoaded();
            if (myEnterSeq !== enState.enterSpaceSeq) return;
          } else {
            ensureTop10kLoaded()
              .then(() => {
                if (enState.currentWord) renderNearbyWords(enState.currentWord);
              })
              .catch(() => {});
          }
        }

        await applyFilterAndRender(false);
        if (myEnterSeq !== enState.enterSpaceSeq) return;

        const rawPending = enState._pendingJumpWord;
        const isCurrentJump = rawPending && rawPending.jumpSeq === enState.jumpSeq;
        if (rawPending && rawPending.jumpSeq <= enState.jumpSeq) {
          enState._pendingJumpWord = null;
        }
        if (rawPending && !isCurrentJump) {
          return;
        }
        const pending = isCurrentJump ? rawPending.entry : null;
        if (rawPending && isCurrentJump) {
          rawPending.handled = true;
        }

        if (pending) {
          const idx = enState.filteredList.findIndex((x) => x.w === pending.w);
          if (idx >= 0) {
            while (idx >= enState.renderedCount && enState.renderedCount < enState.filteredList.length) {
              renderWordList('append');
            }
          }
          await selectWord(pending);
          if (myEnterSeq !== enState.enterSpaceSeq) return;
          document.querySelector('#enWordList .kanji-item.active')?.scrollIntoView({ block: 'nearest' });
        } else {
          const savedWord = s?.enLastWord || '';
          if (!enState.currentWord && !enState.skipNextRestore && viewMode !== 'enDue' && savedWord) {
            const idx = enState.filteredList.findIndex((x) => x.w === savedWord);
            if (idx >= 0) {
              while (idx >= enState.renderedCount && enState.renderedCount < enState.filteredList.length) {
                renderWordList('append');
              }
              await selectWord(enState.filteredList[idx], false);
              if (myEnterSeq !== enState.enterSpaceSeq) return;
              document.querySelector('#enWordList .kanji-item.active')?.scrollIntoView({ block: 'nearest' });
            } else if (enState.filteredList.length) {
              await selectWord(enState.filteredList[0], false);
              if (myEnterSeq !== enState.enterSpaceSeq) return;
            }
          } else if ((!enState.currentWord || enState.skipNextRestore || viewMode === 'enDue') && enState.filteredList.length) {
            await selectWord(enState.filteredList[0], !enState.skipNextRestore && viewMode !== 'enDue');
            if (myEnterSeq !== enState.enterSpaceSeq) return;
          }
        }

        if (viewMode === 'enSquadron') {
          setEnMode('squadron');
        } else if (enState.currentMode === 'squadron') {
          setEnMode('anatomy');
        }

        enState.sessionRestored = true;
        enState.skipNextRestore = false;
      })();

      enState._enterSpacePromise = run;
      try {
        await run;
      } finally {
        if (enState._enterSpacePromise === run) {
          enState._enterSpacePromise = null;
        }
      }
    },
  };

  bindEvents();
  bindEnReaderEvents();
  bindMediaCoachEvents();
  bindSquadronEvents();
  ensureEnDataLoaded().catch((err) => {
    console.error('English data preload failed:', err);
  });
  ensureReadingsLoaded().catch(() => {});
})();
