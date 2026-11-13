// Marking and band conversion for IELTS Academic Reading.

// Raw score out of 40 -> band (the widely published Academic Reading conversion; real papers vary by a mark or so).
const BANDS = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5],
  [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1], [0, 0],
];
export const BAND_TABLE = BANDS;

export function bandFor(raw40) {
  for (const [min, band] of BANDS) if (raw40 >= min) return band;
  return 0;
}

export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

// "(the) river / stream" -> ["theriver", "river", "stream"]
export function alternatives(keyText) {
  const out = new Set();
  const expand = (s, depth) => {
    const m = s.match(/\(([^)]*)\)/);
    if (!m || depth > 4) return void out.add(norm(s));
    expand(s.replace(m[0], m[1]), depth + 1);
    expand(s.replace(m[0], ''), depth + 1);
  };
  for (const alt of String(keyText ?? '').split('/')) if (alt.trim()) expand(alt, 0);
  out.delete('');
  return [...out];
}

export function mark(test, passageNums, answers) {
  const key = test.key || { answers: {}, either: [] };
  const detail = {};
  const perPassage = [];
  let raw = 0;
  let total = 0;
  for (const p of test.passages) {
    if (!passageNums.includes(p.num)) continue;
    const nums = p.groups.flatMap((g) => g.nums);
    const done = new Set();
    let got = 0;
    for (const n of nums) {
      if (done.has(n)) continue;
      const set = (key.either || []).find((e) => e.includes(n)) || [n];
      const pool = set.map((k) => ({ k, alts: alternatives(key.answers[k]), used: false }));
      for (const k of set) {
        done.add(k);
        const given = String(answers[k] ?? '').trim();
        const g = norm(given);
        let hit = null;
        if (g) hit = pool.find((x) => !x.used && x.alts.includes(g)) || null;
        if (hit) hit.used = true;
        detail[k] = { given, ok: !!hit, correct: set.length > 1 ? set.map((x) => key.answers[x]).filter(Boolean).join(' , ') : key.answers[k] ?? '' , either: set.length > 1 };
        if (hit) got++;
      }
    }
    perPassage.push({ num: p.num, title: p.title, raw: got, total: nums.length });
    raw += got;
    total += nums.length;
  }
  const scaled = total ? Math.round((raw / total) * 40) : 0;
  return { raw, total, scaled, band: bandFor(scaled), estimated: total !== 40, perPassage, detail };
}
