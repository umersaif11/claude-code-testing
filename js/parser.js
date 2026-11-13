// Turns extracted PDF lines into structured reading tests.
// Tuned for the layout of the Cambridge IELTS Academic practice-test books, but written against
// structural cues (headings, numbering, instruction wording) rather than any one edition.

const sp = (s) => s.replace(/[\t ]+/g, ' ').trim();
const pk = (l) => l.pk ?? l.page * 2;
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);

const RE_PASSAGE = /^READING\s*PASSAGE\s*([1-3])$/;
const RE_GROUP = /^Questions?\s*(\d{1,2})(?:\s*(?:[-–—~]|and|&|to)\s*(\d{1,2}))?$/i;
const RE_RUNNING_HEAD = /^(Test\s*\d|Reading|Listening|Writing|Speaking)$/i;
const RE_SECTION_END = /^(WRITING|LISTENING|SPEAKING|WRITING\s*TASK\s*\d|Audioscripts)$/;
const RE_INSTRUCTION =
  /^(Complete|Choose|Write|Label|Answer|Do the following|In boxes|Look at|Match|NB|Which|Reading Passage|You may|Classify|Use |TRUE|FALSE|YES|NO|NOT GIVEN)/;
const DOTS = /[.·…_•‥∙⋅]{4,}(?:[\s.·…_•‥∙⋅,-]*[.·…_•‥∙⋅]+)*|[.·…_•-]{6,}/g;
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv'];
const GAP = (n) => `⟦${n}⟧`;

export function parseBook(pages) {
  const warnings = [];
  const frames = pages.map(framePage);
  const tests = collectTests(pages, frames).map((t) => ({
    num: t.num,
    passages: t.passages.map((p) => parsePassage(p, t.num, frames, warnings)),
  }));
  const keys = parseKeys(pages);
  for (const t of tests) {
    t.key = keys[t.num] || { answers: {}, either: [] };
    const nums = t.passages.flatMap((p) => p.groups.flatMap((g) => g.nums));
    const missing = nums.filter((n) => !(n in t.key.answers));
    if (missing.length) warnings.push(`Test ${t.num}: no answer found in the key for question(s) ${missing.join(', ')}.`);
    // "Choose TWO letters" answers may be given in either order even when the key does not say so.
    for (const p of t.passages)
      for (const g of p.groups)
        if (g.type === 'multi' && !t.key.either.some((e) => e.includes(g.from))) t.key.either.push(g.nums);
  }
  if (!tests.length) warnings.push('No "READING PASSAGE" headings were found in this PDF.');
  return { tests, warnings };
}

// ---------- page furniture ----------

function framePage(page) {
  const H = page.height;
  const drop = new Set();
  let top = H * 0.04;
  let bottom = H * 0.96;
  page.lines.forEach((l, i) => {
    const t = sp(l.text);
    if (i < 2 && l.y < H * 0.35 && RE_RUNNING_HEAD.test(t) && !/^[A-Z]+$/.test(t)) {
      drop.add(i);
      top = Math.max(top, l.y + 6);
    }
    if (l.y > H * 0.9 && t.length <= 24 && (/^\d{1,3}$/.test(t) || /[➔→]|\bp\.\s*\d/.test(t) || t.length <= 4)) {
      drop.add(i);
      bottom = Math.min(bottom, l.y - l.h - 4);
    }
  });
  const kept = page.lines.filter((_, i) => !drop.has(i));
  const x0 = Math.max(0, Math.min(...kept.map((l) => l.x), page.width * 0.2) - 16);
  const x1 = Math.min(page.width, Math.max(...kept.map((l) => l.x2), page.width * 0.8) + 16);
  const head = page.lines.slice(0, 2).map((l) => sp(l.text).match(/^Test\s*(\d)$/)).find(Boolean);
  return { kept, top, bottom, x0, x1, headTest: head ? +head[1] : null };
}

// ---------- locate tests and passages ----------

function collectTests(pages, frames) {
  const tests = [];
  let headTest = null;
  let cur = null;
  pages.forEach((page, pi) => {
    const fr = frames[pi];
    if (fr.headTest) headTest = fr.headTest;
    for (const l of fr.kept) {
      const t = sp(l.text);
      if (RE_SECTION_END.test(t) || /answer keys$/i.test(t)) {
        cur = null;
        continue;
      }
      if (t === 'READING') continue;
      const m = t.match(RE_PASSAGE);
      if (m) {
        const n = +m[1];
        let test = tests[tests.length - 1];
        if (!test || n === 1 || test.passages.some((p) => p.num >= n)) {
          const num = headTest && !tests.some((x) => x.num === headTest) ? headTest : (test ? test.num : 0) + 1;
          test = { num, passages: [] };
          tests.push(test);
        }
        cur = { num: n, lines: [], start: { page: pi, y: l.y, h: l.h } };
        test.passages.push(cur);
        continue;
      }
      if (cur) cur.lines.push({ ...l, page: pi, t });
    }
  });
  return tests;
}

// ---------- passage ----------

function parsePassage(src, testNum, frames, warnings) {
  let lines = src.lines;
  let range = null;
  const i0 = lines.slice(0, 4).findIndex((l) => /^You should spend/i.test(l.t));
  if (i0 >= 0) {
    let i1 = i0;
    while (i1 < i0 + 3 && i1 < lines.length - 1 && !/below\.?$/i.test(lines[i1].t)) i1++;
    const intro = lines.slice(i0, i1 + 1).map((l) => l.t).join(' ');
    const m = intro.match(/Questions?\s*(\d{1,2})\s*[-–—~]\s*(\d{1,2})/i);
    if (m) range = [+m[1], +m[2]];
    lines = lines.slice(i1 + 1);
  }

  // Split into the passage text and question groups.
  let pre = [];
  const sections = [];
  for (const l of lines) {
    const m = l.t.match(RE_GROUP);
    if (m && (!range || (+m[1] >= range[0] && +m[1] <= range[1]))) {
      sections.push({ from: +m[1], to: m[2] ? +m[2] : +m[1], header: l, lines: [] });
    } else if (sections.length) sections[sections.length - 1].lines.push(l);
    else pre.push(l);
  }

  // Some passages put a question group (usually a list of headings) before the text.
  let bodyStart = src.start;
  if (pre.length < 4 && sections.length) {
    const sec = sections[0];
    const cut = findPassageStart(sec);
    if (cut > 0) {
      pre = pre.concat(sec.lines.slice(cut));
      sec.lines = sec.lines.slice(0, cut);
      sec.endsAt = pre[0];
      bodyStart = { page: pre[0].page, y: pre[0].y, h: pre[0].h };
    }
  }

  const body = parsePassageBody(splitColumns(pre));
  const groups = sections.map((sec, i) => {
    const next = sec.endsAt || (sections[i + 1] && sections[i + 1].header);
    const g = parseGroup(sec);
    g.regions = regionsFor([sec.header, ...sec.lines], sec.header, next, frames);
    return g;
  });

  const firstGroupAfterBody = sections.find((s) => !s.endsAt);
  const passage = {
    num: src.num,
    ...body,
    range: range || (groups.length ? [groups[0].from, groups[groups.length - 1].to] : [0, 0]),
    regions: regionsFor(pre, bodyStart, firstGroupAfterBody && firstGroupAfterBody.header, frames),
    groups,
  };

  const where = `Test ${testNum}, Passage ${src.num}`;
  if (!passage.paragraphs.length) warnings.push(`${where}: could not find the passage text.`);
  if (range) {
    const have = new Set(groups.flatMap((g) => g.nums));
    const miss = [];
    for (let n = range[0]; n <= range[1]; n++) if (!have.has(n)) miss.push(n);
    if (miss.length) warnings.push(`${where}: question(s) ${miss.join(', ')} were not found.`);
  }
  for (const g of groups) if (g.incomplete) warnings.push(`${where}: questions ${g.from}–${g.to} may not have been read cleanly; the original page is shown alongside.`);
  return passage;
}

function findPassageStart(sec) {
  const seen = new Set();
  const need = sec.to - sec.from + 1;
  const hs = [];
  for (let i = 0; i < sec.lines.length; i++) {
    const l = sec.lines[i];
    const m = l.t.match(/^(\d{1,2})\b/);
    if (m && +m[1] >= sec.from && +m[1] <= sec.to) seen.add(+m[1]);
    else if (seen.size >= need && i > 0) {
      const big = l.h >= 1.25 * median(hs);
      const newPage = l.page !== sec.lines[i - 1].page;
      if (big || newPage) return i;
    }
    hs.push(l.h);
  }
  return -1;
}

// Passages are sometimes set in two columns; the line builder sees those as one wide line with a
// tab at the gutter. Split such pages into a left run followed by a right run.
function splitColumns(lines) {
  const out = [];
  const pages = [...new Set(lines.map((l) => l.page))];
  for (const page of pages) {
    const mine = lines.filter((l) => l.page === page);
    const left = Math.min(...mine.map((l) => l.x));
    const right = Math.max(...mine.map((l) => l.x2));
    const count = {};
    for (const l of mine)
      for (const s of l.segs) {
        if (s.x < left + 0.3 * (right - left)) continue;
        const b = Math.round(s.x / 4);
        count[b] = (count[b] || 0) + 1;
      }
    const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const total = best ? count[best] + (count[+best - 1] || 0) + (count[+best + 1] || 0) : 0;
    if (!best || total < Math.max(6, mine.length * 0.3)) {
      out.push(...mine);
      continue;
    }
    const X = best * 4;
    const atX = (s) => Math.abs(s.x - X) <= 7;
    const colLines = mine.filter((l) => l.segs.some(atX));
    const yA = colLines[0].y - 1;
    const yB = colLines[colLines.length - 1].y + 1;
    const mk = (l, segs, col) => ({
      ...l, segs, x: segs[0].x, pk: page * 2 + col,
      text: segs.map((s) => s.text).join('\t'), t: sp(segs.map((s) => s.text).join(' ')),
    });
    const L = [];
    const R = [];
    const before = [];
    const after = [];
    for (const l of mine) {
      if (l.y < yA) before.push(l);
      else if (l.y > yB) (l.x >= X - 7 ? R : after).push(l.x >= X - 7 ? mk(l, l.segs, 1) : l);
      else {
        const i = l.segs.findIndex(atX);
        if (i < 0) L.push(mk(l, l.segs, 0));
        else {
          if (i > 0) L.push(mk(l, l.segs.slice(0, i), 0));
          R.push(mk(l, l.segs.slice(i), 1));
        }
      }
    }
    out.push(...before, ...L, ...R, ...after.map((l) => mk(l, l.segs, 1)));
  }
  return out;
}

const ENDS_SENTENCE = /[.!?:]['"’”)\]]*$/;

function joinLines(parts) {
  let out = '';
  for (const p of parts) {
    const s = sp(p);
    if (!s) continue;
    if (!out) out = s;
    else if (/[a-z]-$/.test(out) && /^[a-z]/.test(s)) out += s;
    else out += ' ' + s;
  }
  return out.replace(/\s+([,.;:!?])/g, '$1');
}

function baseSpacing(lines) {
  const hs = lines.map((l) => l.h);
  const mh = median(hs) || 10;
  const dys = [];
  for (let i = 1; i < lines.length; i++) {
    const dy = lines[i].y - lines[i - 1].y;
    if (pk(lines[i]) === pk(lines[i - 1]) && dy > 2) dys.push(dy);
  }
  dys.sort((a, b) => a - b);
  const q = dys.length ? dys[Math.floor(dys.length / 4)] : mh * 1.25;
  return Math.min(Math.max(q, mh * 0.95), mh * 1.6);
}

function markBlocks(lines) {
  const base = baseSpacing(lines);
  return lines.map((l, i) => {
    const prev = lines[i - 1];
    const gap = !prev || pk(prev) !== pk(l) || l.y - prev.y > 1.3 * base;
    return { ...l, gap, newPage: !!prev && pk(prev) !== pk(l) };
  });
}

function parsePassageBody(raw) {
  const out = { title: '', subtitle: '', paragraphs: [], footnotes: [] };
  if (!raw.length) return out;
  const bodyH = median(raw.map((l) => l.h));
  const foot = raw.filter((l) => l.h < 0.78 * bodyH);
  for (const l of foot) {
    if (/^[*•·†‡]/.test(l.t) || !out.footnotes.length) out.footnotes.push(l.t);
    else out.footnotes[out.footnotes.length - 1] += ' ' + l.t;
  }
  const lines = markBlocks(raw.filter((l) => l.h >= 0.78 * bodyH));
  let i = 0;
  const title = [];
  while (i < lines.length && lines[i].h >= 1.25 * bodyH) title.push(lines[i++].t);
  if (!title.length && lines.length > 1 && lines[0].t.length < 70 && lines[1].gap) title.push(lines[i++].t);
  out.title = joinLines(title);

  // Left margin per page, ignoring paragraph letters.
  const margins = {};
  for (const l of lines.slice(i)) (margins[pk(l)] ||= []).push(Math.round(l.x));
  for (const k in margins) {
    const count = {};
    let best = null;
    for (const x of margins[k]) {
      const b = Math.round(x / 3);
      count[b] = (count[b] || 0) + 1;
      if (best === null || count[b] > count[best]) best = b;
    }
    margins[k] = best * 3;
  }

  // An introductory blurb: a short centred/indented block straight after the title.
  let j = i;
  while (j < lines.length && (j === i || !lines[j].gap)) j++;
  const blurb = lines.slice(i, j);
  if (out.title && blurb.length && blurb.length <= 5 && j < lines.length && !/^[A-Z]\t/.test(blurb[0].text) &&
      blurb.some((l) => Math.abs(l.x - margins[pk(l)]) > 6)) {
    out.subtitle = joinLines(blurb.map((l) => l.t));
    i = j;
  }

  let cur = null;
  let lastLabel = null;
  for (let k = i; k < lines.length; k++) {
    const l = lines[k];
    const prev = k > i ? lines[k - 1] : null;
    let label = null;
    let text = l.text;
    const m = l.text.match(/^([A-Z])([\t ])(.+)$/s);
    if (m) {
      const expected = lastLabel ? String.fromCharCode(lastLabel.charCodeAt(0) + 1) : 'A';
      const nxt = lines[k + 1];
      const hanging = !!nxt && pk(nxt) === pk(l) && nxt.x - l.x > 10;
      if (m[1] === expected && (m[2] === '\t' || (hanging && (l.gap || !cur)))) {
        label = lastLabel = m[1];
        text = m[3];
      }
    }
    let start = !cur || !!label;
    if (!start && l.newPage) start = ENDS_SENTENCE.test(prev.t) && /^['"‘“(]?[A-Z0-9]/.test(l.t);
    else if (!start && l.gap) start = true;
    else if (!start && l.x > prev.x + 8 && ENDS_SENTENCE.test(prev.t) && Math.abs(prev.x - (margins[pk(prev)] ?? prev.x)) < 40) start = true;
    if (start) {
      cur = { label, parts: [] };
      out.paragraphs.push(cur);
    }
    cur.parts.push(text);
  }
  out.paragraphs = out.paragraphs.map((p) => ({ label: p.label, text: joinLines(p.parts) })).filter((p) => p.text);
  return out;
}

// ---------- question groups ----------

function letterRange(a, b) {
  const out = [];
  for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
}

function detectChoices(instr) {
  let m = instr.match(/\b(i)\s*[-–—]\s*([ivx]{1,5})\b/);
  if (m && ROMAN.includes(m[2])) return ROMAN.slice(0, ROMAN.indexOf(m[2]) + 1);
  m = instr.match(/\b([A-Z])\s*[-–—]\s*([A-Z])\b/);
  if (m && m[1] < m[2]) return letterRange(m[1], m[2]);
  m = instr.match(/\bA,\s*B(?:,\s*[C-F])*,?\s*or\s*([B-G])\b/);
  if (m) return letterRange('A', m[1]);
  return null;
}

const isLabel = (s) => /^[A-P]$/.test(s) || ROMAN.includes(s);
const labelOrder = (lab) => (ROMAN.includes(lab) ? ROMAN.indexOf(lab) : lab.charCodeAt(0));

// Reads option rows such as "A\ttext", several per row ("A\ttext\tE\ttext"), or boxes where the
// label is only a space away ("A reliability\tB funding"). Returns [{label|null, text, x}] or null.
function parseOptionLine(line, list, nextLine, prevRow) {
  const out = [];
  let spaced = 0;
  for (const seg of line.segs) {
    const t = seg.text.trim();
    const last = out[out.length - 1];
    const m = t.match(/^([A-P]|[ivx]{1,5})\s+(\S.*)$/);
    if (isLabel(t) && (!last || last.text)) out.push({ label: t, text: '', x: null });
    else if (last && !last.text) {
      last.text = t;
      last.x = seg.x;
    } else if (m && isLabel(m[1])) {
      out.push({ label: m[1], text: m[2], x: seg.x });
      spaced++;
    } else if (last) {
      // Either a cell whose letter was lost (it lines up with a column of the row above) or just
      // more of the current option's text after a wide gap.
      const column = prevRow && prevRow.find((o) => seg.x - o.x >= -8 && seg.x - o.x <= 26);
      if (column && seg.x - last.x > 30) out.push({ label: null, text: t, x: seg.x });
      else last.text += ' ' + t;
    } else return null;
  }
  if (!out.length || !out[0].label || out.some((o) => !o.text)) return null;
  const labelled = out.filter((o) => o.label);
  if (labelled.some((o) => list.some((x) => x.label === o.label))) return null;
  if (spaced && labelled.length < 2) {
    // A lone "A text" row is only an option if it continues the list (or clearly starts one).
    const lab = labelled[0].label;
    const prev = list[list.length - 1];
    const follows = prev && labelOrder(lab) === labelOrder(prev.label) + 1;
    const starts = !list.length && (lab === 'A' || lab === 'i') && nextLine && /^(B|ii)[\t ]/.test(nextLine.text);
    if (!follows && !starts) return null;
    if (out.length > 1) return null;
  }
  // A cell that lost its letter in the scan takes the next letter along.
  for (let i = 1; i < out.length; i++) {
    if (out[i].label) continue;
    const prev = out[i - 1].label;
    out[i].label = ROMAN.includes(prev) ? ROMAN[ROMAN.indexOf(prev) + 1] : String.fromCharCode(prev.charCodeAt(0) + 1);
    if (!out[i].label || list.some((x) => x.label === out[i].label)) return null;
  }
  return out;
}

// A wrapped line under a row of options: attach each piece to the option above it.
function continueOptions(row, line) {
  if (row.length === 1) {
    row[0].text += ' ' + line.t;
    return;
  }
  for (const seg of line.segs) {
    let best = row[0];
    for (const o of row) if (Math.abs(o.x - seg.x) < Math.abs(best.x - seg.x)) best = o;
    best.text += ' ' + seg.text.trim();
  }
}

function parseGroup(sec) {
  const { from, to } = sec;
  const nums = [];
  for (let n = from; n <= to; n++) nums.push(n);
  const lines = markBlocks(sec.lines);

  // Leading instruction blocks.
  let i = 0;
  const instructions = [];
  while (i < lines.length) {
    const l = lines[i];
    if (!RE_INSTRUCTION.test(l.t) || /^\d/.test(l.t)) break;
    const block = [l.t];
    i++;
    while (i < lines.length && !lines[i].gap) block.push(lines[i++].t);
    const text = joinLines(block);
    if (/^(TRUE|FALSE|YES|NO|NOT GIVEN)\b/.test(text)) continue; // legend, rebuilt by the UI
    instructions.push(text);
  }
  const instr = instructions.join(' ');
  const body = lines.slice(i);

  let type;
  let pick = 1;
  const multi = instr.match(/Choose\s+(TWO|THREE|FOUR)\s+(letters|answers)/i);
  if (/NOT\s*GIVEN/.test(instr + ' ' + sec.lines.slice(0, 8).map((l) => l.t).join(' '))) {
    type = /\bTRUE\b/.test(sec.lines.map((l) => l.t).join(' ')) ? 'tfng' : 'ynng';
  } else if (multi) {
    type = 'multi';
    pick = { TWO: 2, THREE: 3, FOUR: 4 }[multi[1].toUpperCase()];
  } else if (/Choose the correct letter/i.test(instr)) type = 'mcq';
  else if (/^(Complete|Label|Answer)/m.test(instructions.join('\n')) && !/correct ending/i.test(instr)) type = 'completion';
  else type = 'matching';

  const g = {
    from, to, nums, type, pick,
    instructions,
    notes: [], options: [], questions: [], rows: [],
    choices: null,
    // Tables and diagrams lose their layout as plain text, so the UI shows the scanned original.
    visual: /\b(table|diagram|map|plan)\b/i.test(instr),
    flow: /flow-?chart/i.test(instr) || undefined,
    incomplete: false,
  };
  if (type === 'tfng') g.choices = ['TRUE', 'FALSE', 'NOT GIVEN'];
  else if (type === 'ynng') g.choices = ['YES', 'NO', 'NOT GIVEN'];
  else if (type !== 'completion' || /correct (letter|number)|list of (words|phrases)|from the box/i.test(instr)) g.choices = detectChoices(instr);

  if (type === 'completion') parseCompletionBody(g, body);
  else parseItemBody(g, body);

  if (type !== 'completion' || g.choices) {
    const labels = (type === 'mcq' ? g.questions.flatMap((q) => q.options) : g.options).map((o) => o.label);
    if (!g.choices && labels.length) g.choices = [...new Set(labels)];
    if (!g.choices) g.choices = letterRange('A', 'H');
    for (const lab of labels) if (!g.choices.includes(lab)) g.choices.push(lab);
  }

  // Make sure every question number can be answered even if the text was not read cleanly.
  const have = new Set(type === 'completion' ? gapsIn(g.rows) : type === 'multi' ? nums : g.questions.map((q) => q.n));
  for (const n of nums) {
    if (have.has(n)) continue;
    g.incomplete = true;
    if (type === 'completion') g.rows.push({ text: GAP(n) });
    else g.questions.push({ n, text: '', options: [] });
  }
  if (type === 'mcq' && g.questions.some((q) => q.options.length < 2)) g.incomplete = true;
  if (type === 'multi' && g.options.length < pick + 1) g.incomplete = true;
  g.questions.sort((a, b) => a.n - b.n);
  if (g.incomplete) g.visual = true;
  return g;
}

function gapsIn(rows) {
  const out = [];
  for (const r of rows) for (const m of r.text.matchAll(/⟦(\d+)⟧/g)) out.push(+m[1]);
  return out;
}

function parseItemBody(g, lines) {
  const seen = new Set();
  let cur = null; // whatever continuation lines attach to
  let curQ = null;
  let optRow = null;
  const flush = [];
  const open = (target, first) => {
    const o = { target, parts: [first] };
    flush.push(o);
    cur = o;
    optRow = null;
  };
  lines.forEach((l, idx) => {
    const mQ = l.text.match(/^(\d{1,2})(?:[\t ]+(.*))?$/s);
    if (mQ && g.type !== 'multi') {
      const n = +mQ[1];
      if (n >= g.from && n <= g.to && !seen.has(n)) {
        seen.add(n);
        curQ = { n, text: '', options: [] };
        g.questions.push(curQ);
        open(curQ, mQ[2] || '');
        return;
      }
    }
    const list = g.type === 'mcq' && curQ ? curQ.options : g.options;
    const opts = parseOptionLine(l, list, lines[idx + 1], optRow);
    if (opts) {
      optRow = opts.map((o) => ({ label: o.label, text: o.text, x: o.x }));
      list.push(...optRow);
      cur = null;
      return;
    }
    if (optRow && !l.gap) continueOptions(optRow, l);
    else if (l.gap || !cur) {
      const note = { text: '' };
      g.notes.push(note);
      open(note, l.text);
    } else cur.parts.push(l.text);
  });
  for (const o of flush) o.target.text = joinLines(o.parts);
  g.notes = g.notes.map((n) => n.text).filter(Boolean);
  const tidy = (list) => list.sort((a, b) => labelOrder(a.label) - labelOrder(b.label)).forEach((o) => { o.text = sp(o.text); delete o.x; });
  tidy(g.options);
  g.questions.forEach((q) => tidy(q.options));
}

function parseCompletionBody(g, lines) {
  const inRange = (n) => n >= g.from && n <= g.to;
  const rows = [];
  let cur = null;
  let lastOpt = null;
  for (const [idx, l] of lines.entries()) {
    const opts = g.choices ? parseOptionLine(l, g.options, lines[idx + 1], lastOpt) : null;
    if (opts) {
      lastOpt = opts;
      g.options.push(...opts);
      cur = null;
      continue;
    }
    const t = l.t;
    const bullet = /^[•·▪■◆*-]\s/.test(t) || /^[•·▪■◆]$/.test(t);
    const mNum = t.match(/^(\d{1,2})\s/);
    const numbered = !!mNum && inRange(+mNum[1]) && !new RegExp(`^${mNum[1]}\\s*[.·…_]{4,}`).test(t);
    if (!cur && lastOpt && !l.gap && !bullet && !numbered) {
      continueOptions(lastOpt, l);
      continue;
    }
    if (l.gap || bullet || numbered || !cur) {
      cur = { parts: [], bullet, x: l.x, h: l.h, first: l };
      rows.push(cur);
      lastOpt = null;
    }
    cur.parts.push(bullet ? t.replace(/^[•·▪■◆*-]\s*/, '') : t);
  }

  const seen = new Set();
  const bodyH = median(lines.map((l) => l.h));
  g.rows = rows.map((r, idx) => {
    let text = joinLines(r.parts);
    text = text.replace(new RegExp(`(^|[^\\d-])(\\d{1,2})\\s*(?:${DOTS.source})`, 'g'), (all, pre, n) => {
      if (!inRange(+n) || seen.has(+n)) return all;
      seen.add(+n);
      return `${pre}${GAP(n)} `;
    });
    const lead = text.match(/^(\d{1,2})\s+(?!⟦)/);
    if (lead && inRange(+lead[1]) && !seen.has(+lead[1])) {
      const n = +lead[1];
      seen.add(n);
      text = text.slice(lead[0].length);
      let used = false;
      text = text.replace(DOTS, (d) => (used ? d : ((used = true), GAP(n) + ' ')));
      if (!used) text += ' ' + GAP(n);
      r.numbered = n;
    }
    text = text.replace(DOTS, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    const hasGap = /⟦/.test(text);
    return {
      text,
      bullet: r.bullet || undefined,
      n: r.numbered,
      title: (idx === 0 && !hasGap && !r.bullet && (r.h > bodyH * 1.15 || text.length < 60)) || undefined,
      heading: (idx > 0 && !hasGap && !r.bullet && r.parts.length === 1 && text.length < 60) || undefined,
    };
  }).filter((r) => r.text);

  // Gaps whose dotted line did not survive OCR: fall back to the bare number, in order.
  for (const n of g.nums) {
    if (seen.has(n)) continue;
    const re = new RegExp(`(^|[\\s(])${n}(?=$|[\\s,.;:)])`);
    const row = g.rows.find((r) => re.test(r.text));
    if (row) {
      row.text = row.text.replace(re, `$1${GAP(n)}`);
      seen.add(n);
    }
  }
  g.options.sort((a, b) => labelOrder(a.label) - labelOrder(b.label)).forEach((o) => { o.text = sp(o.text); delete o.x; });
}

// ---------- page regions (for showing the original scan) ----------

function regionsFor(lines, start, next, frames) {
  const pages = [...new Set([start.page, ...lines.map((l) => l.page)])].sort((a, b) => a - b);
  return pages.map((p) => {
    const fr = frames[p];
    const mine = lines.filter((l) => l.page === p);
    let y0 = p === start.page ? start.y - (start.h || 11) * 1.6 : fr.top;
    let y1 = fr.bottom;
    if (next && next.page === p && next.y > y0) y1 = next.y - (next.h || 11) * 1.6;
    else if (next && next.page > p) y1 = fr.bottom;
    if (mine.length) y0 = Math.min(y0, mine[0].y - mine[0].h * 1.6);
    return { page: p, x0: round(fr.x0), x1: round(fr.x1), y0: round(Math.max(0, y0)), y1: round(y1) };
  }).filter((r) => r.y1 - r.y0 > 12);
}
const round = (n) => Math.round(n * 10) / 10;

// ---------- answer keys ----------

function parseKeys(pages) {
  const keys = {};
  for (const page of pages) {
    const texts = page.lines.map((l) => sp(l.text));
    if (!texts.includes('READING') || !texts.some((t) => /^Reading Passage\s*\d/.test(t)) || texts.some((t) => RE_PASSAGE.test(t))) continue;
    const mt = texts.map((t) => t.match(/^TEST\s*(\d)$/)).find(Boolean);
    const testNum = mt ? +mt[1] : Object.keys(keys).length + 1;
    const stop = page.lines.find((l) => /^If you score/i.test(sp(l.text)));
    const yStop = stop ? stop.y - 2 : Infinity;
    const yStart = page.lines.find((l) => sp(l.text) === 'READING').y;
    const segs = [];
    for (const l of page.lines) {
      if (l.y >= yStop || l.y <= yStart) continue;
      for (const s of l.segs) segs.push({ x: s.x, y: l.y, text: s.text.trim() });
    }
    const heads = segs.filter((s) => /^Reading Passage/.test(s.text)).map((s) => s.x).sort((a, b) => a - b);
    const xs = segs.map((s) => s.x);
    let split = (Math.min(...xs) + Math.max(...xs)) / 2;
    if (heads.length && heads[heads.length - 1] - heads[0] > 60) split = heads[heads.length - 1] - 12;
    const key = (keys[testNum] ||= { answers: {}, either: [] });
    for (const col of [segs.filter((s) => s.x < split), segs.filter((s) => s.x >= split)]) readKeyColumn(col, key);
  }
  return keys;
}

function readKeyColumn(segs, key) {
  segs.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const s of segs) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(s.y - r.y) < 4) r.text += ' ' + s.text;
    else rows.push({ y: s.y, text: s.text });
  }
  let pair = null;
  let last = null;
  // OCR often reads the "/" between alternative answers as a capital I or l.
  const clean = (a) => sp(a).replace(/\bNOT\s*GIVEN\b/i, 'NOT GIVEN').replace(/(\S) [Il|] (?=\S)/g, '$1 / ').replace(/\s*\/\s*/g, ' / ');
  for (const r of rows) {
    const t = sp(r.text);
    if (/^Reading Passage|^Questions?\s*\d|Answer key|Resource Bank|^[-–—g]$/i.test(t)) continue;
    let m = t.match(/^(\d{1,2})\s*(?:&|and)\s*(\d{1,2})\b\s*(.*)$/i);
    if (m) {
      pair = { nums: [+m[1], +m[2]], got: 0 };
      key.either.push(pair.nums);
      last = null;
      continue;
    }
    m = t.match(/^(\d{1,2})(?:\s+(.+))?$/);
    if (m && +m[1] >= 1 && +m[1] <= 40 && !(+m[1] in key.answers)) {
      last = +m[1];
      key.answers[last] = clean(m[2] || '');
      pair = null;
      continue;
    }
    if (/EITHER\s*ORDER/i.test(t)) continue;
    if (pair && pair.got < pair.nums.length) {
      key.answers[pair.nums[pair.got++]] = clean(t);
    } else if (last !== null) {
      key.answers[last] = clean(key.answers[last] + ' ' + t);
    }
  }
}
