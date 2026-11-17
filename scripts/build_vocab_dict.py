import concurrent.futures
import json
import os
import re
import time
import urllib.parse
import requests
import pykakasi

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, 'data')
CACHE_DIR = os.path.join(ROOT_DIR, 'scripts', '.cache')
os.makedirs(CACHE_DIR, exist_ok=True)

READINGS_PATH = os.path.join(DATA_DIR, 'readings.json')
SENTENCES_PATH = os.path.join(DATA_DIR, 'sentences.json')
KANJI_LOOKUP_PATH = os.path.join(DATA_DIR, 'kanji-lookup.json')
VOCAB_DICT_PATH = os.path.join(DATA_DIR, 'vocab-dict.json')
MAZII_CACHE_PATH = os.path.join(CACHE_DIR, 'mazii-vocab-cache.json')
MYMEM_CACHE_PATH = os.path.join(CACHE_DIR, 'mymem-vocab-cache.json')

KANJI_RE = re.compile(r'[\u4e00-\u9faf々]')
PURE_KANJI_RE = re.compile(r'^[\u4e00-\u9faf々]+$')

# Keep real words that happen to end with a character used as a particle
KEEP_EXACT_TOKENS = {
    '今日は', '実は', '一緒に', '単に', '単純に', '同時に', '非常に',
    '逆に', '最も', '誰も', '何も', '何か', '何と', '静か', '豊か', '確か',
}

# Verb/Adjective conjugated stems ending in か/が/た/ら/ま/ば/な/わ are NOT particle-glued nouns
STEM_PARTICLES_STRIP = set('のをはがにへとでも')

# Known contextual reading fixes over raw pykakasi output
READING_FIXES = {
    '日本': 'にほん',
    '一日': 'いちにち',
    '六つ': 'むっつ',
    '何': 'なに',
    '方': 'かた',
    '十分': 'じゅうぶん',
    '今日': 'きょう',
    '明日': 'あした',
    '昨日': 'きのう',
    '今年': 'ことし',
    '大人': 'おとな',
    '一人': 'ひとり',
    '二人': 'ふたり',
    '四人': 'よにん',
    '朝九時': 'あさくじ',
    '大きい': 'おおきい',
    '小さい': 'ちいさい',
    '多い': 'おおい',
    '遠い': 'とおい',
}

HIRA_VOWEL_EXTEND = {
    'あ': 'あ', 'か': 'あ', 'さ': 'あ', 'た': 'あ', 'な': 'あ', 'は': 'あ', 'ま': 'あ', 'や': 'あ', 'ら': 'あ', 'わ': 'あ',
    'が': 'あ', 'ざ': 'あ', 'だ': 'あ', 'ば': 'あ', 'ぱ': 'あ',
    'い': 'い', 'き': 'い', 'し': 'い', 'ち': 'い', 'に': 'い', 'ひ': 'い', 'み': 'い', 'り': 'い',
    'ぎ': 'い', 'じ': 'い', 'ぢ': 'い', 'び': 'い', 'ぴ': 'い',
    'う': 'う', 'く': 'う', 'す': 'う', 'つ': 'う', 'ぬ': 'う', 'ふ': 'う', 'む': 'う', 'ゆ': 'う', 'る': 'う',
    'ぐ': 'う', 'ず': 'う', 'づ': 'う', 'ぶ': 'う', 'ぷ': 'う',
    'え': 'い', 'け': 'い', 'せ': 'い', 'て': 'い', 'ね': 'い', 'へ': 'い', 'め': 'い', 'れ': 'い',
    'げ': 'い', 'ぜ': 'い', 'で': 'い', 'べ': 'い', 'ぺ': 'い',
    'お': 'う', 'こ': 'う', 'そ': 'う', 'と': 'う', 'の': 'う', 'ほ': 'う', 'も': 'う', 'よ': 'う', 'ろ': 'う', 'を': 'う',
    'ご': 'う', 'ぞ': 'う', 'ど': 'う', 'ぼ': 'う', 'ぽ': 'う',
    'ょ': 'う', 'ゃ': 'あ', 'ゅ': 'う',
}

CONJ_END_MAP = {
    'い': ['う', 'いる'],
    'き': ['く', 'きる'],
    'ぎ': ['ぐ', 'ぎる'],
    'し': ['す', 'する'],
    'ち': ['つ', 'ちる'],
    'に': ['ぬ', 'にる'],
    'び': ['ぶ', 'びる'],
    'み': ['む', 'みる'],
    'り': ['る'],
    'え': ['える'],
    'け': ['ける'],
    'げ': ['げる'],
    'せ': ['せる'],
    'て': ['てる'],
    'ね': ['ねる'],
    'べ': ['べる'],
    'め': ['める'],
    'れ': ['れる'],
    'っ': ['う', 'つ', 'る'],
    'ん': ['ぶ', 'む', 'ぬ'],
    'わ': ['う'],
    'か': ['く', 'い'],
    'が': ['ぐ'],
    'さ': ['す'],
    'た': ['つ'],
    'な': ['ぬ'],
    'ば': ['ぶ'],
    'ま': ['む'],
    'ら': ['る'],
    'く': ['い'],
    'かっ': ['い'],
    'くな': ['い'],
}


def fix_hira_long_vowels(orig, hira):
    if orig in READING_FIXES:
        return READING_FIXES[orig]
    if 'ー' not in hira or re.search(r'[\u30a0-\u30ff]', orig):
        return hira
    # Replace ー inside pure Hiragana readings converted by pykakasi (e.g. ちーさい -> ちいさい)
    out = []
    for ch in hira:
        if ch == 'ー' and out:
            prev = out[-1]
            # Special case: おーき / おーい -> おお
            if prev == 'お':
                out.append('お')
            else:
                out.append(HIRA_VOWEL_EXTEND.get(prev, 'う'))
        else:
            out.append(ch)
    return ''.join(out)


def strip_html(text):
    if not text:
        return ''
    clean = re.sub(r'<[^>]+>', '', text)
    return re.sub(r'\s+', ' ', clean).strip()


def candidate_base_forms(word):
    cands = [word]
    for suf, repls in CONJ_END_MAP.items():
        if word.endswith(suf) and len(word) > len(suf):
            stem = word[:-len(suf)]
            for r in repls:
                cands.append(stem + r)
    # Also handle noun+する or na-adj
    if word.endswith('だ'):
        cands.append(word[:-1])
    return list(dict.fromkeys(cands))


def compute_han_viet(word, kanji_lookup):
    parts = []
    for ch in word:
        if ch in kanji_lookup and kanji_lookup[ch].get('hv'):
            parts.append(kanji_lookup[ch]['hv'])
    return ' '.join(parts)


def extract_kanji_tokens(text, kks):
    items = kks.convert(text)
    out = []
    for it in items:
        orig = it['orig']
        hira = fix_hira_long_vowels(orig, it['hira'])
        if not KANJI_RE.search(orig):
            continue
        # Strip accidental trailing particle glued by pykakasi (e.g., 中の -> 中, 何を -> 何)
        if orig not in KEEP_EXACT_TOKENS and len(orig) >= 2 and orig[-1] in STEM_PARTICLES_STRIP and PURE_KANJI_RE.match(orig[:-1]):
            base_orig = orig[:-1]
            base_hira = hira[:-1] if hira.endswith(orig[-1]) or (orig[-1] == 'は' and hira.endswith('は')) else ''
            if not base_hira:
                base_hira = fix_hira_long_vowels(base_orig, kks.convert(base_orig)[0]['hira'])
            out.append((base_orig, base_hira))
        elif orig.endswith('かっ') and len(orig) >= 3:
            adj_orig = orig[:-2] + 'い'
            adj_hira = fix_hira_long_vowels(adj_orig, hira[:-2] + 'い')
            out.append((orig[:-1], hira[:-1]))
        else:
            out.append((orig, hira))
    return out


def fetch_mazii(query, cache, lock):
    with lock:
        if query in cache:
            return cache[query]
    try:
        res = requests.post(
            'https://mazii.net/api/search',
            json={'dict': 'javi', 'type': 'word', 'query': query, 'limit': 8, 'page': 1},
            timeout=6,
        )
        data = res.json().get('data') or [] if res.status_code == 200 else []
    except Exception:
        data = []
    with lock:
        cache[query] = data
    return data


def fetch_mymemory(query, cache, lock):
    with lock:
        if query in cache:
            return cache[query]
    try:
        url = 'https://api.mymemory.translated.net/get?q=' + urllib.parse.quote(query) + '&langpair=ja|vi'
        res = requests.get(url, timeout=6)
        txt = ''
        if res.status_code == 200:
            txt = (res.json().get('responseData') or {}).get('translatedText') or ''
    except Exception:
        txt = ''
    with lock:
        cache[query] = txt
    return txt


def best_mazii_match(word, candidates, mazii_results_by_query):
    # Priority 1: exact match for word itself
    for item in mazii_results_by_query.get(word, []):
        if item.get('word') == word:
            return item, False
    # Priority 2: exact match for one of de-inflected base forms
    for base in candidates:
        if base == word:
            continue
        for item in mazii_results_by_query.get(base, []):
            if item.get('word') == base:
                return item, base
        for item in mazii_results_by_query.get(word, []):
            if item.get('word') == base:
                return item, base
    return None, False


def main():
    with open(READINGS_PATH, 'r', encoding='utf-8') as f:
        readings = json.load(f)
    with open(SENTENCES_PATH, 'r', encoding='utf-8') as f:
        sentences = json.load(f)
    with open(KANJI_LOOKUP_PATH, 'r', encoding='utf-8') as f:
        kanji_lookup = json.load(f)

    mazii_cache = {}
    if os.path.exists(MAZII_CACHE_PATH):
        with open(MAZII_CACHE_PATH, 'r', encoding='utf-8') as f:
            mazii_cache = json.load(f)

    mymem_cache = {}
    if os.path.exists(MYMEM_CACHE_PATH):
        with open(MYMEM_CACHE_PATH, 'r', encoding='utf-8') as f:
            mymem_cache = json.load(f)

    kks = pykakasi.kakasi()
    vocab_dict = {}

    # Seed with curated paragraph vocab first (highest priority for contextual meanings)
    curated_vocab = {}
    all_kanji_tokens = {}

    for r in readings:
        for p in r['paragraphs']:
            for v in p.get('vocab', []):
                word, read, meaning = v[0], v[1], v[2]
                if KANJI_RE.search(word):
                    curated_vocab[word] = {
                        'r': READING_FIXES.get(word, read),
                        'm': meaning,
                        'hv': compute_han_viet(word, kanji_lookup),
                    }
            for orig, hira in extract_kanji_tokens(p['jp'], kks):
                all_kanji_tokens.setdefault(orig, hira)

    for s in sentences:
        for orig, hira in extract_kanji_tokens(s['fullJp'], kks):
            all_kanji_tokens.setdefault(orig, hira)

    # Ensure every single Kanji in readings/sentences is also in lookup
    words_to_lookup = sorted(set(all_kanji_tokens.keys()) | set(curated_vocab.keys()))
    print(f'Unique Kanji tokens extracted: {len(all_kanji_tokens)}, Curated vocab: {len(curated_vocab)}')

    # Build query list (word + candidate base forms)
    word_cands = {w: candidate_base_forms(w) for w in words_to_lookup if w not in curated_vocab}
    all_mazii_queries = sorted({q for cands in word_cands.values() for q in cands} | set(curated_vocab.keys()))
    missing_mazii = [q for q in all_mazii_queries if q not in mazii_cache]
    print(f'Mazii queries total: {len(all_mazii_queries)}, cached: {len(all_mazii_queries) - len(missing_mazii)}, fetching: {len(missing_mazii)}')

    import threading
    lock = threading.Lock()
    if missing_mazii:
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
            list(ex.map(lambda q: fetch_mazii(q, mazii_cache, lock), missing_mazii))
        with open(MAZII_CACHE_PATH, 'w', encoding='utf-8') as f:
            json.dump(mazii_cache, f, ensure_ascii=False)

    # Assemble vocab_dict
    unresolved_for_mymem = []
    for w in words_to_lookup:
        hv = compute_han_viet(w, kanji_lookup)
        if w in curated_vocab:
            entry = dict(curated_vocab[w])
            # Enrich Hán-Việt from Mazii if available
            hit, _ = best_mazii_match(w, [w], mazii_cache)
            if hit and hit.get('han'):
                entry['hv'] = hit['han']
            elif not entry['hv']:
                entry['hv'] = hv
            vocab_dict[w] = entry
            continue

        cands = word_cands[w]
        hit, base_used = best_mazii_match(w, cands, mazii_cache)
        py_read = READING_FIXES.get(w, all_kanji_tokens.get(w, w))

        if hit:
            mean = strip_html(hit.get('short_mean', ''))
            # Pick first phonetic reading only if exact match (not conjugated stem)
            phon = (hit.get('phonetic') or '').split(' ')[0].strip()
            read = py_read if (base_used or w in READING_FIXES or not phon) else phon
            # Avoid Katakana inside phonetic unless word has Katakana
            if re.search(r'[\u30a0-\u30ff]', read) and not re.search(r'[\u30a0-\u30ff]', w):
                read = py_read
            han = (hit.get('han') or hv or '').strip()
            if base_used and base_used != w:
                mean = f'{mean} ({base_used})'
            vocab_dict[w] = {'r': read, 'm': mean, 'hv': han}
        else:
            unresolved_for_mymem.append((w, py_read, hv))

    print(f'Resolved via curated/Mazii: {len(vocab_dict)}, Remaining compounds for MyMemory/Kanji fallback: {len(unresolved_for_mymem)}')
    if unresolved_for_mymem:
        missing_mm = [w for w, _, _ in unresolved_for_mymem if w not in mymem_cache]
        if missing_mm:
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
                list(ex.map(lambda w: fetch_mymemory(w, mymem_cache, lock), missing_mm))
            with open(MYMEM_CACHE_PATH, 'w', encoding='utf-8') as f:
                json.dump(mymem_cache, f, ensure_ascii=False)

        for w, py_read, hv in unresolved_for_mymem:
            mm_mean = (mymem_cache.get(w) or '').strip()
            kanji_parts_vi = [
                f"{ch} ({kanji_lookup[ch]['vi'].split(',')[0].strip()})"
                for ch in w if ch in kanji_lookup and kanji_lookup[ch].get('vi')
            ]
            # If MyMemory echoes back Japanese or fails, build from Kanji meanings
            if not mm_mean or KANJI_RE.search(mm_mean) or 'MYMEMORY' in mm_mean.upper():
                mean = ' + '.join(kanji_parts_vi)
            else:
                mean = mm_mean
            vocab_dict[w] = {'r': py_read, 'm': mean, 'hv': hv}

    # Add special compound examples that appear adjacent in N5-01 like 朝九時 if helpful?
    # Wait: pykakasi splits 朝 (あさ) + 九時 (くじ), which is actually much clearer for learners than glomming them!
    # Also attach per-paragraph "words" list in readings.json so UI renders exact Ruby segmentation cleanly
    for r in readings:
        for p in r['paragraphs']:
            seen_w = {}
            # Prefer curated vocab first (handles パン屋, 起きて, 食べながら, 日曜日...)
            for v in p.get('vocab', []):
                w = v[0]
                if w in vocab_dict:
                    seen_w[w] = vocab_dict[w]
            for orig, _ in extract_kanji_tokens(p['jp'], kks):
                if orig in vocab_dict and orig not in seen_w:
                    seen_w[orig] = vocab_dict[orig]
            # Sort by descending length so longest-match never misses multi-char compounds
            sorted_words = sorted(seen_w.items(), key=lambda kv: (-len(kv[0]), kv[0]))
            p['words'] = [[w, info['r'], info['m'], info['hv']] for w, info in sorted_words]

    with open(VOCAB_DICT_PATH, 'w', encoding='utf-8') as f:
        json.dump(vocab_dict, f, ensure_ascii=False, indent=2)
    with open(READINGS_PATH, 'w', encoding='utf-8') as f:
        json.dump(readings, f, ensure_ascii=False, indent=2)

    print(f'Successfully wrote {len(vocab_dict)} entries to {VOCAB_DICT_PATH} and enriched words in {READINGS_PATH}')


if __name__ == '__main__':
    main()
