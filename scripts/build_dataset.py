import collections
import gzip
import json
import os
import re
import shutil
import urllib.request
import xml.etree.ElementTree as ET

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT_DIR, 'scripts', '.cache')
DATA_DIR = os.path.join(ROOT_DIR, 'data')

SOURCES = {
    'kanji.json': 'https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json',
    'kanji_bank_1.json': 'https://raw.githubusercontent.com/trungnt2910/KanjiDictVN/master/out_vn/kanji_bank_1.json',
    'kanji_bank_2.json': 'https://raw.githubusercontent.com/trungnt2910/KanjiDictVN/master/out_vn/kanji_bank_2.json',
    'kanjivg.xml.gz': 'https://github.com/KanjiVG/kanjivg/releases/download/r20260714/kanjivg-20260714.xml.gz',
}

KVG_NS = '{http://kanjivg.tagaini.net}'

# Mapping Japanese Shinjitai -> Kyujitai for KanjiDictVN entries whose meanings live under Kyujitai
SHINJITAI_TO_KYUJITAI = {
    '広': '廣', '図': '圖', '売': '賣', '黒': '黑', '対': '對', '絵': '繪', '実': '實',
    '県': '縣', '軽': '輕', '読': '讀', '戦': '戰', '緑': '綠', '駅': '驛', '囲': '圍',
    '単': '單', '変': '變', '険': '險', '渉': '涉', '焼': '燒', '脳': '腦', '団': '團',
    '圧': '壓', '済': '濟', '挙': '舉', '検': '檢', '収': '收', '沢': '澤', '抜': '拔',
    '満': '滿', '巻': '卷', '捜': '搜', '獣': '獸', '悩': '惱', '処': '處', '壊': '壞',
    '渇': '渴', '懐': '懷', '騒': '騷', '桜': '櫻', '雑': '雜', '銭': '錢', '訳': '譯',
    '拡': '擴', '蔵': '藏', '臓': '臟', '縦': '縱', '払': '拂', '廃': '廢', '縄': '繩',
    '継': '繼', '頼': '賴', '塁': '壘', '戻': '戾', '恵': '惠', '掲': '揭', '齢': '齡',
    '渋': '澁', '稲': '稻', '譲': '讓', '駆': '驅', '瀬': '瀨', '拠': '據', '蛍': '螢',
    '鉱': '礦', '竜': '龍', '縁': '緣', '涙': '淚', '嬢': '孃', '霊': '靈', '穏': '穩',
    '錬': '鍊', '穂': '穗', '黙': '默', '砕': '碎', '挿': '插', '畳': '疊', '奨': '獎',
    '駄': '馱', '釈': '釋', '陥': '陷', '寛': '寬', '壌': '壤', '舗': '鋪', '顕': '顯',
    '粛': '肅', '髄': '髓', '摂': '攝', '醸': '釀', '戯': '戲', '鶏': '鷄', '暁': '曉',
    '鋳': '鑄', '渓': '溪', '桟': '棧', '壱': '壹', '巌': '巖', '尭': '堯', '薫': '薰',
    '穣': '穰', '逓': '遞', '弐': '貳', '惣': '總',
}

# Fallback Vietnamese meanings for Kokuji and the handful of variants missing in KanjiDictVN
VI_FALLBACK = {
    '査': ('TRA', ['điều tra, xem xét, kiểm tra']),
    '絶': ('TUYỆT', ['đứt đoạn, chấm dứt, tuyệt đối']),
    '郷': ('HƯƠNG', ['quê hương, làng quê']),
    '閲': ('DUYỆT', ['xem xét, kiểm duyệt, duyệt qua']),
    '槙': ('ĐIÊN', ['cây bách nhỏ, cành cây thường xanh']),
    '込': ('VU', ['nhồi nhét, đi vào, bao gồm (Kokuji)']),
    '枠': ('HOA', ['khung, khuôn, khung gỗ (Kokuji)']),
    '塀': ('BÍNH', ['tường rào, bức tường bao (Kokuji)']),
    '峠': ('ĐÈO', ['đỉnh đèo, đèo núi, điểm cao trào (Kokuji)']),
    '冴': ('NHẠ', ['trong trẻo, sắc bén, lạnh giá']),
    '笹': ('THẾ', ['lá trúc nhỏ, cây trúc lùn (Kokuji)']),
    '凪': ('ĐÌNH (KOKUJI)', ['lặng gió, biển lặng sóng êm (Kokuji)']),
    '柊': ('CHUNG', ['cây nhựa ruồi (hiiragi)']),
    '蕗': ('LỘ (KOKUJI)', ['cây rau húng dổi Nhật / cây fuki']),
    '柾': ('CỮU', ['thớ gỗ thẳng, cây masaki (Kokuji)']),
    '麿': ('MA', ['ta, tôi (đại từ cổ trong tên người Nhật, Kokuji)']),
    '椋': ('LƯƠNG (KOKUJI)', ['cây muku, chim sáo xám (Kokuji)']),
    '匁': ('LẠNG', ['đơn vị cân lượng cổ của Nhật (~3.75g, Kokuji)']),
    '滉': ('HOẢNG', ['sâu rộng, mênh mông (nước)']),
    '澪': ('LINH', ['luồng nước, dòng chảy dẫn thuyền']),
}

# Helpful Vietnamese labels for KanjiVG strokes/components not directly in KanjiDictVN
COMPONENT_FALLBACK = {
    '丿': ('PHIỆT', 'nét phẩy trái'),
    '丨': ('CỔN', 'nét sổ dọc'),
    '丶': ('CHỦ', 'nét chấm'),
    '亠': ('ĐẦU', 'bộ đầu (nóc, phần trên)'),
    '冖': ('MỊCH', 'bộ mịch (trùm, che phủ)'),
    '乂': ('NGẢI', 'cắt, giao nhau'),
    '厶': ('TƯ', 'riêng tư, hình tam giác'),
    'マ': ('MA', 'hình chữ Katakana Ma'),
    '⺍': ('TIỂU', 'ba nét chấm trên đầu'),
    '𠂇': ('TẢ', 'tay trái / nét ngang phẩy'),
    '𠂉': ('NHÂN NẰM', 'người cúi / phẩy ngang'),
    '龰': ('CHỈ', 'bộ chỉ / bước chân biến thể'),
    '龶': ('CHỦ', 'ba nét ngang xuyên dọc'),
    '龹': ('QUYỂN', 'phần đầu chữ quyển'),
    'CDP-8BC4': ('BỘ PHẬN', 'nét hợp thành'),
    'CDP-8CB8': ('BỘ PHẬN', 'nét hợp thành'),
}

# IDC (Ideographic Description Character) explanations in Vietnamese
IDC_NAMES = {
    '⿰': 'Kết cấu Trái – Phải',
    '⿱': 'Kết cấu Trên – Dưới',
    '⿲': 'Kết cấu Trái – Giữa – Phải',
    '⿳': 'Kết cấu Trên – Giữa – Dưới',
    '⿴': 'Kết cấu Bao quanh toàn bộ',
    '⿵': 'Kết cấu Bao trên & hai bên',
    '⿶': 'Kết cấu Bao dưới & hai bên',
    '⿷': 'Kết cấu Bao trái & trên dưới',
    '⿸': 'Kết cấu Bao góc Trên – Trái',
    '⿹': 'Kết cấu Bao góc Trên – Phải',
    '⿺': 'Kết cấu Bao góc Dưới – Trái',
    '⿻': 'Kết cấu Giao nhau / Chồng nét',
}


def ensure_sources():
    os.makedirs(CACHE_DIR, exist_ok=True)
    for name, url in SOURCES.items():
        dest = os.path.join(CACHE_DIR, name)
        if not os.path.exists(dest):
            print(f'Downloading {name}...')
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r, open(dest, 'wb') as f:
                f.write(r.read())
        else:
            print(f'Using cached {name}')


def clean_vi_meaning(entry_list):
    """Extract clean meanings and primary Han-Viet reading from KanjiDictVN meanings array."""
    meanings = []
    bracket_hv = None
    for item in entry_list:
        m = re.match(r'^\[([^\]]+)\]\s*(.*)$', item.strip())
        if m:
            if bracket_hv is None:
                bracket_hv = m.group(1).strip()
            text = m.group(2).strip()
        else:
            text = item.strip()
        if text and text not in meanings:
            meanings.append(text)
    return bracket_hv, meanings


def lookup_vn_info(ch, vn_map):
    row = vn_map.get(ch)
    hv_all = []
    primary_hv = ''
    meanings = []
    radical_vi = ''
    shape = ''

    if row:
        hv_all = [x.strip() for x in (row[1] or '').split() if x.strip()]
        radical_vi = (row[5] or {}).get('Radical', '')
        shape = (row[5] or {}).get('Shape', '')
        bracket_hv, meanings = clean_vi_meaning(row[4] or [])
        if bracket_hv:
            primary_hv = bracket_hv.upper()
        elif hv_all:
            primary_hv = hv_all[0].upper()

    if not meanings and ch in SHINJITAI_TO_KYUJITAI:
        kyu = SHINJITAI_TO_KYUJITAI[ch]
        krow = vn_map.get(kyu)
        if krow:
            bracket_hv, kmeanings = clean_vi_meaning(krow[4] or [])
            meanings = kmeanings
            if not primary_hv and bracket_hv:
                primary_hv = bracket_hv.upper()

    if not meanings and ch in VI_FALLBACK:
        fb_hv, fb_meanings = VI_FALLBACK[ch]
        meanings = fb_meanings
        if not primary_hv:
            primary_hv = fb_hv

    if not primary_hv and ch in VI_FALLBACK:
        primary_hv = VI_FALLBACK[ch][0]

    return {
        'hv': primary_hv or 'CHƯA RÕ',
        'hvAll': hv_all,
        'vi': meanings[:6],
        'rad': radical_vi,
        'shape': shape,
    }


def describe_component(elem, orig, vn_map):
    """Get concise Vietnamese Han-Viet + meaning for a KanjiVG component element."""
    for candidate in (elem, orig):
        if candidate and candidate in COMPONENT_FALLBACK:
            hv, meaning = COMPONENT_FALLBACK[candidate]
            return hv, meaning
        if candidate and candidate in vn_map:
            row = vn_map[candidate]
            hv_all = [x.strip() for x in (row[1] or '').split() if x.strip()]
            bracket_hv, meanings = clean_vi_meaning(row[4] or [])
            hv = (bracket_hv or (hv_all[0] if hv_all else '')).upper()
            short_meaning = meanings[0] if meanings else ''
            if short_meaning:
                return hv, short_meaning
            if hv:
                return hv, ''
    return '', ''


def parse_kanjivg_entry(kanji_el, kanji_char, vn_map):
    """Extract ordered SVG strokes and anatomical component tree from a KanjiVG <kanji> node."""
    top_g = kanji_el.find('g')
    if top_g is None:
        return [], []

    path_to_idx = {}
    strokes = []
    for p in top_g.iter('path'):
        idx = len(strokes)
        path_to_idx[p] = idx
        strokes.append(p.attrib.get('d', ''))

    components = []

    def walk(node, depth):
        # Collect direct child <g> nodes, merging split kvg:part pieces at the same level
        merged_children = collections.OrderedDict()
        for child in list(node):
            if child.tag != 'g':
                continue
            elem = child.attrib.get(KVG_NS + 'element') or ''
            orig = child.attrib.get(KVG_NS + 'original') or ''
            pos = child.attrib.get(KVG_NS + 'position') or ''
            rad = child.attrib.get(KVG_NS + 'radical') or ''
            phon = child.attrib.get(KVG_NS + 'phon') or ''
            part = child.attrib.get(KVG_NS + 'part') or ''
            desc_indices = [path_to_idx[p] for p in child.iter('path') if p in path_to_idx]

            if not elem:
                # Transparent wrapper group (e.g. left/right half of 門); recurse at same logical depth
                walk(child, depth)
                continue

            # If split via kvg:part, merge stroke indices under one logical component key
            key = ('part', elem, orig) if part else ('node', id(child))
            if key in merged_children:
                existing = merged_children[key]
                existing['strokes'].extend(desc_indices)
                existing['_nodes'].append(child)
            else:
                hv, vi = describe_component(elem, orig, vn_map)
                comp = {
                    'el': elem,
                    'orig': orig,
                    'pos': pos,
                    'rad': rad,
                    'phon': phon,
                    'depth': depth,
                    'hv': hv,
                    'vi': vi,
                    'strokes': list(desc_indices),
                    '_nodes': [child],
                }
                merged_children[key] = comp

        for comp in merged_children.values():
            sub_nodes = comp.pop('_nodes')
            # Deduplicate and sort stroke indices
            comp['strokes'] = sorted(set(comp['strokes']))
            # Clean empty optional fields to keep JSON compact
            cleaned = {
                'el': comp['el'],
                'depth': comp['depth'],
                'strokes': comp['strokes'],
            }
            if comp['orig']:
                cleaned['orig'] = comp['orig']
            if comp['pos']:
                cleaned['pos'] = comp['pos']
            if comp['rad']:
                cleaned['rad'] = comp['rad']
            if comp['phon']:
                cleaned['phon'] = comp['phon']
            if comp['hv']:
                cleaned['hv'] = comp['hv']
            if comp['vi']:
                cleaned['vi'] = comp['vi']
            components.append(cleaned)
            for sn in sub_nodes:
                walk(sn, depth + 1)

    walk(top_g, 1)

    # Atomic kanji (no sub-groups): expose self as single component
    if not components and strokes:
        hv, vi = describe_component(kanji_char, '', vn_map)
        components.append({
            'el': kanji_char,
            'depth': 1,
            'strokes': list(range(len(strokes))),
            'rad': 'general',
            **({'hv': hv} if hv else {}),
            **({'vi': vi} if vi else {}),
        })

    components.sort(key=lambda c: (min(c['strokes']) if c['strokes'] else 999, c['depth']))
    return strokes, components


def kata_from_hira(text):
    """Convert Hiragana readings in kanji.json readings_on to standard Katakana."""
    out = []
    for ch in text:
        code = ord(ch)
        if 0x3041 <= code <= 0x3096:
            out.append(chr(code + 0x60))
        else:
            out.append(ch)
    return ''.join(out)


def main():
    ensure_sources()

    print('Loading source JSON & XML...')
    with open(os.path.join(CACHE_DIR, 'kanji.json'), encoding='utf-8') as f:
        kd = json.load(f)
    with open(os.path.join(CACHE_DIR, 'kanji_bank_1.json'), encoding='utf-8') as f:
        vn1 = json.load(f)
    with open(os.path.join(CACHE_DIR, 'kanji_bank_2.json'), encoding='utf-8') as f:
        vn2 = json.load(f)

    vn_map = {row[0]: row for row in (vn1 + vn2)}

    with gzip.open(os.path.join(CACHE_DIR, 'kanjivg.xml.gz'), 'rb') as f:
        tree = ET.parse(f)
    root = tree.getroot()
    kvg_map = {}
    for k_el in root.findall('kanji'):
        kid = k_el.attrib.get('id', '')
        if '_' in kid:
            try:
                ch = chr(int(kid.split('_')[-1], 16))
                kvg_map[ch] = k_el
            except ValueError:
                pass

    by_level = {5: [], 4: [], 3: [], 2: [], 1: []}
    comp_to_kanji = collections.defaultdict(list)
    kanji_level_lookup = {}
    jlpt_old_to_new = {4: 5, 3: 4, 2: 3, 1: 1}
    extra_level_overrides = {'的': 4, '無': 4}

    for ch, meta in kd.items():
        lvl = meta.get('jlpt_new') or extra_level_overrides.get(ch) or jlpt_old_to_new.get(meta.get('jlpt_old'))
        if lvl not in by_level:
            continue
        if ch not in kvg_map:
            raise RuntimeError(f'Missing KanjiVG entry for {ch}')

        vn_info = lookup_vn_info(ch, vn_map)
        strokes, parts = parse_kanjivg_entry(kvg_map[ch], ch, vn_map)

        shape_desc = ''
        if vn_info['shape']:
            idc_char = vn_info['shape'][0]
            shape_desc = IDC_NAMES.get(idc_char, '')

        entry = {
            'c': ch,
            'l': lvl,
            's': len(strokes),
            'g': meta.get('grade'),
            'f': meta.get('freq'),
            'hv': vn_info['hv'],
            'hvAll': vn_info['hvAll'],
            'vi': vn_info['vi'],
            'en': (meta.get('meanings') or [])[:6],
            'on': [kata_from_hira(r) for r in (meta.get('readings_on') or [])],
            'kun': meta.get('readings_kun') or [],
            'rad': vn_info['rad'],
            'shape': vn_info['shape'],
            'shapeDesc': shape_desc,
            'wkRad': meta.get('wk_radicals') or [],
            'strokes': strokes,
            'parts': parts,
        }
        by_level[lvl].append(entry)
        kanji_level_lookup[ch] = {'l': lvl, 'hv': vn_info['hv'], 'vi': vn_info['vi'][0] if vn_info['vi'] else ''}

    # Sort each JLPT level nicely: frequency (known first), then grade, then stroke count
    for lvl in by_level:
        by_level[lvl].sort(key=lambda x: (
            x['g'] if x['g'] is not None else 99,
            x['f'] if x['f'] is not None else 99999,
            x['s'],
            x['c'],
        ))

    # Build reverse component index (in order N5 -> N1)
    for lvl in (5, 4, 3, 2, 1):
        for entry in by_level[lvl]:
            seen_els = set()
            for p in entry['parts']:
                for key_el in (p['el'], p.get('orig')):
                    if key_el and key_el != entry['c'] and key_el not in seen_els:
                        seen_els.add(key_el)
                        comp_to_kanji[key_el].append(entry['c'])

    components_index = {}
    for el, chars in comp_to_kanji.items():
        hv, vi = describe_component(el, '', vn_map)
        components_index[el] = {
            'hv': hv,
            'vi': vi,
            'chars': chars,
        }

    os.makedirs(DATA_DIR, exist_ok=True)
    total = 0
    for lvl, entries in by_level.items():
        out_path = os.path.join(DATA_DIR, f'kanji-n{lvl}.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(entries, f, ensure_ascii=False, separators=(',', ':'))
        size_kb = os.path.getsize(out_path) / 1024
        total += len(entries)
        print(f'Wrote {out_path}: {len(entries)} kanji ({size_kb:.1f} KB)')

    comp_path = os.path.join(DATA_DIR, 'components-index.json')
    with open(comp_path, 'w', encoding='utf-8') as f:
        json.dump(components_index, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Wrote {comp_path}: {len(components_index)} components ({os.path.getsize(comp_path)/1024:.1f} KB)')

    lookup_path = os.path.join(DATA_DIR, 'kanji-lookup.json')
    with open(lookup_path, 'w', encoding='utf-8') as f:
        json.dump(kanji_level_lookup, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Wrote {lookup_path}: {len(kanji_level_lookup)} entries ({os.path.getsize(lookup_path)/1024:.1f} KB)')

    print(f'TOTAL KANJI BUILT: {total}')

    # Clean up downloaded archive sources so repository stays light
    for fname in SOURCES:
        fpath = os.path.join(CACHE_DIR, fname)
        if os.path.exists(fpath):
            os.remove(fpath)
    print('Cleaned up temporary dataset sources in scripts/.cache/')


if __name__ == '__main__':
    main()
