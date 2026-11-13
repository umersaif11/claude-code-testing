import { db, uid, prefs } from './db.js';
import { importPdfs, showOriginal } from './pdf.js';
import { mark, BAND_TABLE } from './scoring.js';

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clock = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s % 60).padStart(2, '0');
};
const fmtDate = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const TYPE_NAMES = { tfng: 'True / False / Not Given', ynng: 'Yes / No / Not Given', mcq: 'Multiple choice', multi: 'Choose several', matching: 'Matching', completion: 'Completion' };

// ---------- theme ----------
const THEMES = [null, 'light', 'sepia', 'dark'];
const THEME_NAMES = { null: 'Auto', light: 'Light', sepia: 'Sepia', dark: 'Dark' };
function applyTheme() {
  const t = prefs.get('theme', null);
  if (t && THEMES.includes(t)) document.documentElement.dataset.rlTheme = t;
  else delete document.documentElement.dataset.rlTheme;
  for (const b of $$('[data-theme-btn]')) b.textContent = 'Theme: ' + THEME_NAMES[t ?? null];
}
function cycleTheme() {
  const cur = prefs.get('theme', null);
  prefs.set('theme', THEMES[(Math.max(0, THEMES.indexOf(cur)) + 1) % THEMES.length]);
  applyTheme();
}
applyTheme();

// ---------- small UI helpers ----------
function toast(text, ms = 3500) {
  $$('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

// buttons: [{ label, value, kind }] -> resolves with the chosen value (null on Escape)
function dialog(title, bodyHTML, buttons, read) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><div>${bodyHTML}</div>
      <div class="row">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const done = (v) => {
      ov.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => e.key === 'Escape' && done(null);
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const v = buttons[+b.dataset.i].value;
      done(v === true && read ? read() : v);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    $('.btn.primary', ov)?.focus();
  });
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- routing ----------
let leaveExam = null; // set while a timed test is on screen

async function route() {
  if (leaveExam) leaveExam();
  try {
    await routeTo();
  } finally {
    applyTheme();
  }
}

async function routeTo() {
  const parts = location.hash.replace(/^#\/?/, '').split(/[/-]/).filter(Boolean);
  try {
    if (parts[0] === 'book' && parts[2] === 'test') return await setupView(parts[1], +parts[3]);
    if (parts[0] === 'book' && parts[2] === 'key') return await keyView(parts[1]);
    if (parts[0] === 'attempt' && parts[2] === 'review') return await reviewView(parts[1]);
    if (parts[0] === 'attempt') return await resultsView(parts[1]);
    if (parts[0] === 'exam') return await resumeExam();
    return await homeView();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="page"><div class="notice">Something went wrong: ${esc(err?.message || 'this browser is blocking storage for the page')}</div><a class="btn" href="#home">Back to the library</a></div>`;
  }
}
const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};
window.addEventListener('hashchange', route);

const header = (extra = '') => `<div class="top"><a class="brand" href="#home" style="text-decoration:none;color:inherit"><i>R</i>Reading Lab</a><span class="spacer"></span>${extra}<button class="btn small" data-theme-btn>Theme</button></div>`;
app.addEventListener('click', (e) => {
  if (e.target.closest('[data-theme-btn]')) cycleTheme();
});

// ---------- home ----------
async function homeView() {
  const [books, attempts] = await Promise.all([db.all('books'), db.all('attempts')]);
  books.sort((a, b) => b.createdAt - a.createdAt);
  attempts.sort((a, b) => b.submittedAt - a.submittedAt);
  const session = prefs.get('session', null);

  app.innerHTML = `<div class="page">
    ${header()}
    ${session ? `<div class="banner row"><div><b>Test in progress</b> — ${esc(session.bookTitle)}, Test ${session.testNum} (${clock(session.elapsed)} elapsed)</div><span class="spacer"></span><button class="btn" data-discard>Discard</button><a class="btn primary" href="#exam">Resume</a></div>` : ''}
    <div class="drop" id="drop">
      <strong>Add a practice-test book</strong>
      <div class="muted">Drop the PDF here (all parts at once if the book is split across files), or</div>
      <p><button class="btn primary" id="pick">Choose PDF files</button></p>
      <div class="muted small">Passages, questions and answer keys are read in your browser. Nothing is uploaded.</div>
      <input type="file" id="file" accept=".pdf,.json,application/pdf,application/json" multiple hidden>
      <div id="status" class="small" role="status"></div>
    </div>
    <div style="height:18px"></div>
    ${books.length ? books.map(bookCard).join('') : '<p class="muted">Your library is empty. Import a book of IELTS Academic practice tests to begin — the Cambridge IELTS series works well, as long as the PDF has selectable text.</p>'}
    ${attempts.length ? `<div class="card"><h2>History</h2>
      <table class="list" style="margin-top:10px"><thead><tr><th>Date</th><th>Test</th><th>Passages</th><th>Score</th><th>Band</th><th>Time</th><th></th></tr></thead><tbody>
      ${attempts.slice(0, 50).map((a) => `<tr><td>${fmtDate(a.submittedAt)}</td><td>${esc(a.bookTitle)} · Test ${a.testNum}</td><td>${a.passages.join(', ')}</td>
        <td class="num">${a.raw}/${a.total}</td><td class="num"><b>${a.band.toFixed(1)}</b>${a.total !== 40 ? ' <span class="muted">est.</span>' : ''}</td><td class="num">${clock(a.elapsed)}</td>
        <td style="text-align:right"><a class="btn small" href="#attempt-${a.id}">Open</a> <button class="btn small ghost danger" data-del-attempt="${a.id}" aria-label="Delete attempt">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
  </div>`;

  const drop = $('#drop');
  const file = $('#file');
  $('#pick').onclick = () => file.click();
  file.onchange = () => file.files.length && startImport([...file.files]);
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add('over'));
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = [...e.dataTransfer.files].filter((f) => /\.(pdf|json)$/i.test(f.name));
    if (files.length) startImport(files);
  };

  $('.page').onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.discard !== undefined) {
      prefs.set('session', null);
      homeView();
    } else if (t.dataset.delAttempt) {
      await db.del('attempts', t.dataset.delAttempt);
      homeView();
    } else if (t.dataset.delBook) {
      const book = books.find((b) => b.id === t.dataset.delBook);
      const ok = await dialog('Remove this book?', `<p>“${esc(book.title)}” and its stored PDF will be removed from this browser. Your past results stay in the history.</p>`, [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, kind: 'danger' }]);
      if (!ok) return;
      await db.del('books', book.id);
      for (let i = 0; i < book.parts.length; i++) await db.del('files', `${book.id}:${i}`);
      homeView();
    } else if (t.dataset.rename) {
      const book = books.find((b) => b.id === t.dataset.rename);
      const typed = await dialog('Rename book', `<label class="field"><span>Title</span><input type="text" id="rename" value="${esc(book.title)}"></label>`, [{ label: 'Cancel', value: false }, { label: 'Save', value: true, kind: 'primary' }], () => $('#rename').value);
      const name = typed && typed.trim();
      if (name) {
        book.title = name;
        await db.put('books', book);
        homeView();
      }
    } else if (t.dataset.export) {
      const book = books.find((b) => b.id === t.dataset.export);
      download(book.title.replace(/[^\w-]+/g, '_') + '.reading-lab.json', JSON.stringify({ format: 'reading-lab-book', version: 1, book }));
    }
  };
}

function bookCard(book) {
  return `<div class="card">
    <div class="row"><h2>${esc(book.title)}</h2><span class="spacer"></span>
      <button class="btn small ghost" data-rename="${book.id}">Rename</button>
      <a class="btn small ghost" href="#book-${book.id}-key">Answer key</a>
      ${window.RL_NO_DOWNLOAD ? '' : `<button class="btn small ghost" data-export="${book.id}">Export</button>`}
      <button class="btn small ghost danger" data-del-book="${book.id}">Remove</button></div>
    <div class="tests">${book.tests.map((t) => `<a class="test-tile" href="#book-${book.id}-test-${t.num}" style="text-decoration:none;color:inherit">
      <b>Test ${t.num}</b>${t.passages.map((p) => `<span>${p.num}. ${esc(p.title || 'Passage ' + p.num)}</span>`).join('')}</a>`).join('')}</div>
  </div>`;
}

// ---------- import ----------
async function startImport(files) {
  const status = $('#status');
  const say = (t) => status && (status.textContent = t);
  try {
    const json = files.find((f) => /\.json$/i.test(f.name));
    if (json) {
      const data = JSON.parse(await json.text());
      if (data.format !== 'reading-lab-book' || !data.book?.tests) throw new Error('That JSON file is not a Reading Lab export.');
      const book = { ...data.book, id: uid(), createdAt: Date.now() };
      await db.put('books', book);
      toast('Book imported (without the original PDF pages).');
      return homeView();
    }
    const draft = await importPdfs(files, say);
    importReview(draft);
  } catch (err) {
    console.error(err);
    say('');
    await dialog('Could not read that file', `<p>${esc(err.message || String(err))}</p>`, [{ label: 'OK', value: true, kind: 'primary' }]);
  }
}

function importReview(draft) {
  const nTests = draft.tests.length;
  app.innerHTML = `<div class="page">${header()}
    <h1 style="font:700 26px var(--serif)">Check the import</h1>
    <p class="lede">${nTests ? `Found ${nTests} reading test${nTests > 1 ? 's' : ''}. Give the book a name and save it to your library.` : 'No reading tests were found in this PDF.'}</p>
    ${draft.warnings.length ? `<div class="notice"><b>Worth a look</b><ul>${draft.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <div class="small" style="margin-top:6px">You can still practise: the scanned original of every passage and question set is one click away during a test, and the answer key can be edited from the library.</div></div>` : ''}
    <div class="card">
      <label class="field"><b>Book title</b><input type="text" id="title" value="${esc(draft.title)}"></label>
      <div class="muted small">Files, in page order: ${draft.parts.map((p) => `${esc(p.name)} (${p.pages} pages)`).join(' → ')}</div>
    </div>
    ${draft.tests.map((t) => {
      const total = t.passages.reduce((n, p) => n + p.groups.reduce((m, g) => m + g.nums.length, 0), 0);
      const keyed = t.passages.flatMap((p) => p.groups.flatMap((g) => g.nums)).filter((n) => t.key.answers[n]).length;
      return `<div class="card"><div class="row"><h2>Test ${t.num}</h2><span class="spacer"></span><span class="pill ${total === 40 ? 'ok' : 'bad'}">${total} questions</span><span class="pill ${keyed === total ? 'ok' : 'bad'}">${keyed} answers in key</span></div>
        <table class="list" style="margin-top:8px"><thead><tr><th>Passage</th><th>Paragraphs</th><th>Questions</th></tr></thead><tbody>
        ${t.passages.map((p) => `<tr><td><b>${p.num}.</b> ${esc(p.title || '(untitled)')}</td><td class="num">${p.paragraphs.length}</td>
          <td>${p.groups.map((g) => `${g.from === g.to ? g.from : g.from + '–' + g.to} <span class="muted">${TYPE_NAMES[g.type]}${g.incomplete ? ' ⚠' : ''}</span>`).join('<br>')}</td></tr>`).join('')}
        </tbody></table></div>`;
    }).join('')}
    <div class="row"><span class="spacer"></span><a class="btn" href="#home">Cancel</a>${nTests ? '<button class="btn primary" id="save">Save to library</button>' : ''}</div>
  </div>`;
  const save = $('#save');
  if (save) save.onclick = async () => {
    save.disabled = true;
    const book = { id: uid(), title: $('#title').value.trim() || draft.title, createdAt: Date.now(), parts: draft.parts, tests: draft.tests };
    await db.put('books', book);
    for (const [i, blob] of draft.blobs.entries()) await db.put('files', blob, `${book.id}:${i}`);
    toast('Saved to your library.');
    go('#home');
  };
}

// ---------- answer key editor ----------
async function keyView(bookId) {
  const book = await db.get('books', bookId);
  if (!book) return go('#home');
  app.innerHTML = `<div class="page">${header()}
    <h1 style="font:700 26px var(--serif)">Answer key</h1>
    <p class="lede">${esc(book.title)}. Separate alternative answers with “/”. Put optional words in brackets, e.g. <code>(the) river</code>.</p>
    ${book.tests.map((t) => `<div class="card"><h2>Test ${t.num}</h2><div class="answer-grid">
      ${t.passages.flatMap((p) => p.groups.flatMap((g) => g.nums)).map((n) => `<label class="row" style="flex-wrap:nowrap"><b class="num" style="width:2em;text-align:right">${n}</b><input type="text" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:6px;padding:3px 8px;background:var(--bg)" data-t="${t.num}" data-n="${n}" value="${esc(t.key.answers[n] ?? '')}"></label>`).join('')}
      </div>${t.key.either.length ? `<p class="small muted">Accepted in either order: ${t.key.either.map((e) => e.join(' & ')).join('; ')}</p>` : ''}</div>`).join('')}
    <div class="row"><span class="spacer"></span><a class="btn" href="#home">Cancel</a><button class="btn primary" id="save">Save answer key</button></div></div>`;
  $('#save').onclick = async () => {
    for (const input of $$('input[data-n]')) book.tests.find((t) => t.num === +input.dataset.t).key.answers[+input.dataset.n] = input.value.trim();
    await db.put('books', book);
    toast('Answer key saved.');
    go('#home');
  };
}

// ---------- test setup ----------
async function setupView(bookId, testNum) {
  const book = await db.get('books', bookId);
  const test = book?.tests.find((t) => t.num === testNum);
  if (!test) return go('#home');
  const cfg = { timer: 'exam', minutes: 20, onEnd: 'submit', pause: true, warn: true, ...prefs.get('config', {}) };
  app.innerHTML = `<div class="page">${header()}
    <h1 style="font:700 26px var(--serif)">${esc(book.title)} · Test ${test.num}</h1>
    <p class="lede">Choose what to practise and how the clock should behave.</p>
    <div class="grid2" style="margin-top:18px">
      <div class="card"><h2>Passages</h2>
        ${test.passages.map((p) => `<label class="opt"><input type="checkbox" name="p" value="${p.num}" checked><span><b>Passage ${p.num}</b> — ${esc(p.title || '')}<small>Questions ${p.range[0]}–${p.range[1]} · ${p.groups.map((g) => TYPE_NAMES[g.type]).filter((x, i, a) => a.indexOf(x) === i).join(', ')}</small></span></label>`).join('')}
        <div class="row small" style="margin-top:8px"><button class="btn small" data-all>All</button>${test.passages.map((p) => `<button class="btn small" data-only="${p.num}">Only ${p.num}</button>`).join('')}</div>
      </div>
      <div class="card"><h2>Timer</h2>
        <label class="opt"><input type="radio" name="timer" value="exam"><span><b>Exam timing</b><small id="examTime"></small></span></label>
        <label class="opt"><input type="radio" name="timer" value="custom"><span><b>Custom</b> <input type="number" id="minutes" min="1" max="300" value="${cfg.minutes}"> minutes<small>Count down from a time you choose.</small></span></label>
        <label class="opt"><input type="radio" name="timer" value="up"><span><b>Stopwatch</b><small>Count up, no limit — see how long you take.</small></span></label>
        <label class="opt"><input type="radio" name="timer" value="none"><span><b>No timer</b><small>Untimed practice.</small></span></label>
        <h3>When time runs out</h3>
        <label class="opt"><input type="radio" name="onEnd" value="submit"><span><b>Submit automatically</b><small>Like the real test.</small></span></label>
        <label class="opt"><input type="radio" name="onEnd" value="continue"><span><b>Let me finish</b><small>The clock turns red and counts overtime.</small></span></label>
        <h3>Options</h3>
        <label class="opt"><input type="checkbox" id="pause"><span><b>Allow pausing</b><small>Pausing hides the test until you resume.</small></span></label>
        <label class="opt"><input type="checkbox" id="warn"><span><b>Time warnings</b><small>A reminder at 10 and 5 minutes left.</small></span></label>
      </div>
    </div>
    <div class="row"><span class="spacer"></span><a class="btn" href="#home">Back</a><button class="btn primary" id="start">Start test</button></div></div>`;

  $(`input[name=timer][value=${cfg.timer}]`).checked = true;
  $(`input[name=onEnd][value=${cfg.onEnd}]`).checked = true;
  $('#pause').checked = cfg.pause;
  $('#warn').checked = cfg.warn;
  const chosen = () => $$('input[name=p]:checked').map((i) => +i.value);
  const refresh = () => {
    const n = chosen().length;
    $('#examTime').textContent = `20 minutes per passage — ${n * 20} minutes for ${n} passage${n === 1 ? '' : 's'}.`;
    $('#start').disabled = !n;
  };
  refresh();
  $('.page').addEventListener('change', refresh);
  $('#minutes').addEventListener('focus', () => ($('input[name=timer][value=custom]').checked = true));
  $('.page').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.all !== undefined) $$('input[name=p]').forEach((i) => (i.checked = true));
    if (b.dataset.only) $$('input[name=p]').forEach((i) => (i.checked = i.value === b.dataset.only));
    refresh();
  });
  $('#start').onclick = async () => {
    const config = {
      timer: $('input[name=timer]:checked').value,
      minutes: Math.min(300, Math.max(1, +$('#minutes').value || 20)),
      onEnd: $('input[name=onEnd]:checked').value,
      pause: $('#pause').checked,
      warn: $('#warn').checked,
    };
    prefs.set('config', config);
    const existing = prefs.get('session', null);
    if (existing) {
      const ok = await dialog('Replace the test in progress?', '<p>You have an unfinished test saved. Starting a new one discards it.</p>', [{ label: 'Cancel', value: false }, { label: 'Start new test', value: true, kind: 'primary' }]);
      if (!ok) return;
    }
    const passages = chosen();
    const limit = config.timer === 'exam' ? passages.length * 20 * 60 : config.timer === 'custom' ? config.minutes * 60 : null;
    prefs.set('session', { bookId: book.id, bookTitle: book.title, testNum: test.num, passages, config, limit, answers: {}, flags: [], elapsed: 0, startedAt: Date.now() });
    go('#exam');
  };
}

// ---------- rendering a test ----------
const LEGEND = {
  tfng: [['TRUE', 'if the statement agrees with the information'], ['FALSE', 'if the statement contradicts the information'], ['NOT GIVEN', 'if there is no information on this']],
  ynng: [['YES', 'if the statement agrees with the writer'], ['NO', 'if the statement contradicts the writer'], ['NOT GIVEN', 'if it is impossible to say what the writer thinks about this']],
};

function gapControl(n, g) {
  if (g.choices) return `<span class="gapwrap" data-wrap="${n}"><select data-q="${n}" aria-label="Question ${n}"><option value="">${n}</option>${g.choices.map((c) => `<option>${esc(c)}</option>`).join('')}</select></span>`;
  return `<span class="gapwrap" data-wrap="${n}"><input type="text" data-q="${n}" placeholder="${n}" aria-label="Question ${n}" autocomplete="off" autocapitalize="off" spellcheck="false"></span>`;
}
const qn = (n, label) => `<button type="button" class="qn" data-flag="${n}" title="Mark question ${n} for review">${label ?? n}</button>`;
const withGaps = (text, g) => esc(text).replace(/⟦(\d+)⟧/g, (_, n) => gapControl(+n, g));

function optionBox(g) {
  if (!g.options.length && !(g.type === 'matching' && g.notes.length)) return '';
  const short = g.options.length > 4 && g.options.every((o) => o.text.length < 30);
  const notes = g.type === 'multi' ? [] : g.notes;
  return `<div class="box ${short ? 'cols' : ''}">${notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}${g.options.map((o) => `<div class="o"><b>${esc(o.label)}</b><span>${esc(o.text)}</span></div>`).join('')}</div>`;
}

function groupHTML(g, hasPdf) {
  const label = g.from === g.to ? `Question ${g.from}` : `Questions ${g.from}–${g.to}`;
  let body = '';
  if (g.type === 'tfng' || g.type === 'ynng') {
    body = g.questions.map((q) => `<div class="q" data-wrap="${q.n}">${qn(q.n)}<div><div class="qt">${esc(q.text)}</div>
      <div class="choices">${g.choices.map((c) => `<label><input type="radio" name="q${q.n}" value="${c}">${c}</label>`).join('')}</div></div></div>`).join('');
  } else if (g.type === 'mcq') {
    body = g.questions.map((q) => `<div class="q" data-wrap="${q.n}">${qn(q.n)}<div><div class="qt">${esc(q.text)}</div>
      ${q.options.length >= 2
        ? `<div class="mc">${q.options.map((o) => `<label><input type="radio" name="q${q.n}" value="${esc(o.label)}"><b>${esc(o.label)}</b><span>${esc(o.text)}</span></label>`).join('')}</div>`
        : `<div class="choices">${g.choices.map((c) => `<label><input type="radio" name="q${q.n}" value="${esc(c)}">${esc(c)}</label>`).join('')}</div>`}
      </div></div>`).join('');
  } else if (g.type === 'multi') {
    const opts = g.options.length > g.pick ? g.options : g.choices.map((c) => ({ label: c, text: '' }));
    body = `<div class="q" data-wrap="${g.nums.join(' ')}">${qn(g.from, g.nums.join('–'))}<div>
      ${g.notes.map((n) => `<div class="qt">${esc(n)}</div>`).join('')}
      <div class="mc">${opts.map((o) => `<label><input type="checkbox" data-multi="${g.from}" value="${esc(o.label)}"><b>${esc(o.label)}</b><span>${esc(o.text)}</span></label>`).join('')}</div></div></div>`;
  } else if (g.type === 'matching') {
    body = optionBox(g) + g.questions.map((q) => `<div class="q" data-wrap-q="${q.n}">${qn(q.n)}<div><span class="qt">${esc(q.text)}</span> ${gapControl(q.n, g)}</div></div>`).join('');
  } else {
    const grid = `<div class="answer-grid">${g.nums.map((n) => `<div>${qn(n)} ${gapControl(n, g)}</div>`).join('')}</div>`;
    const rows = `<div class="rows ${g.flow ? 'flow' : ''}">${g.rows.map((r) => `<div class="r ${r.title ? 'title' : r.heading ? 'heading' : r.bullet ? 'bullet' : ''}">${withGaps(r.text, g)}</div>`).join('')}</div>`;
    body = (g.visual && hasPdf ? grid : rows) + optionBox(g);
  }
  const legend = LEGEND[g.type] ? `<div class="legend">${LEGEND[g.type].map(([a, b]) => `<b>${a}</b><span>${b}</span>`).join('')}</div>` : '';
  return `<section class="group hl-zone" data-g="${g.from}">
    <div class="group-head"><h3>${label}</h3><span class="spacer"></span>${hasPdf ? `<button class="btn small ghost" data-orig aria-pressed="${g.visual}">Original page</button>` : ''}</div>
    ${g.instructions.map((s, i) => `<p class="instr ${i === 0 ? 'strong' : ''}">${esc(s)}</p>`).join('')}${legend}
    <div class="orig" ${g.visual && hasPdf ? '' : 'hidden'}></div>
    ${body}
  </section>`;
}

function passageHTML(p, hasPdf) {
  return `<div class="pane-head"><b>Passage ${p.num}</b><span>Questions ${p.range[0]}–${p.range[1]}</span><span class="spacer"></span>${hasPdf ? '<button class="btn small ghost" data-orig-passage aria-pressed="false">Original page</button>' : ''}</div>
    <div class="orig" hidden></div>
    <div class="passage hl-zone"><h2>${esc(p.title)}</h2>${p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ''}
    ${p.paragraphs.map((x) => (x.label ? `<p class="lettered"><b>${esc(x.label)}</b><span>${esc(x.text)}</span></p>` : `<p>${esc(x.text)}</p>`)).join('')}
    ${p.footnotes.length ? `<div class="foot">${p.footnotes.map((f) => `<div>${esc(f)}</div>`).join('')}</div>` : ''}</div>`;
}

// Shared by the live test and the review screen.
// opts: { book, test, passages, answers, flags, title, review: null | { detail } , barHTML }
function mountExam(opts) {
  const { book, test } = opts;
  const passages = test.passages.filter((p) => opts.passages.includes(p.num));
  const hasPdf = !!book.parts?.length;
  const answers = opts.answers;
  const flags = new Set(opts.flags);
  const review = opts.review;
  let current = passages[0].num;

  app.innerHTML = `<div class="exam ${review ? 'review' : ''}" style="--fs:${prefs.get('fs', 16)}px">
    <div class="bar">${opts.barHTML}</div>
    <div class="split" style="--left:${prefs.get('split', 50)}%">
      <div class="pane" id="left">${passages.map((p) => `<article data-p="${p.num}" hidden>${passageHTML(p, hasPdf)}</article>`).join('')}</div>
      <div class="divider" id="divider" role="separator" aria-orientation="vertical" aria-label="Resize panes"></div>
      <div class="pane" id="right">${passages.map((p) => `<div data-p="${p.num}" hidden>${p.groups.map((g) => groupHTML(g, hasPdf)).join('')}</div>`).join('')}</div>
    </div>
    <div class="palette" id="palette">${passages.map((p) => `<div class="part" data-p="${p.num}"><button class="pname" data-part="${p.num}">Passage ${p.num}<small></small></button>${p.groups.flatMap((g) => g.nums).map((n) => `<button class="pq" data-n="${n}" aria-label="Question ${n}">${n}</button>`).join('')}</div>`).join('')}
      <span class="spacer"></span><button class="btn small" id="prev" aria-label="Previous passage">‹</button><button class="btn small" id="next" aria-label="Next passage">›</button></div>
  </div>`;
  const root = $('.exam');
  const left = $('#left');
  const right = $('#right');
  const numsOf = (p) => p.groups.flatMap((g) => g.nums);
  const groupOf = (n) => passages.flatMap((p) => p.groups).find((g) => g.nums.includes(n));
  const passageOf = (n) => passages.find((p) => numsOf(p).includes(n));

  function paint() {
    for (const p of passages) {
      const nums = numsOf(p);
      const done = nums.filter((n) => answers[n]).length;
      $(`.part[data-p="${p.num}"] small`).textContent = `${done}/${nums.length}`;
    }
    for (const b of $$('.pq', root)) {
      const n = +b.dataset.n;
      b.classList.toggle('done', !review && !!answers[n]);
      b.classList.toggle('flag', flags.has(n));
      if (review) b.classList.add(review.detail[n]?.ok ? 'ok' : 'bad');
    }
    for (const b of $$('.qn', root)) b.classList.toggle('flag', flags.has(+b.dataset.flag));
  }

  function show(num) {
    current = num;
    for (const el of $$('[data-p]', left).concat($$('[data-p]', right))) el.hidden = +el.dataset.p !== num;
    for (const el of $$('.part', root)) el.classList.toggle('current', +el.dataset.p === num);
    for (const el of $$(`#right [data-p="${num}"] .orig:not([hidden])`)) fillOrig(el);
    const i = passages.findIndex((p) => p.num === num);
    $('#prev').disabled = i === 0;
    $('#next').disabled = i === passages.length - 1;
  }

  function fillOrig(el) {
    const sec = el.closest('.group');
    if (sec) showOriginal(el, book, groupOf(+sec.dataset.g).regions);
    else showOriginal(el, book, passages.find((p) => p.num === +el.closest('[data-p]').dataset.p).regions);
  }

  function goTo(n) {
    const p = passageOf(n);
    if (!p) return;
    if (p.num !== current) show(p.num);
    const wrap = $$('[data-wrap]', right).find((el) => el.dataset.wrap.split(' ').includes(String(n)));
    if (!wrap) return;
    const block = wrap.closest('.q') || wrap;
    block.scrollIntoView({ block: 'center', behavior: 'smooth' });
    block.classList.remove('pulse');
    void block.offsetWidth;
    block.classList.add('pulse');
    const ctl = $('input:not(:disabled), select:not(:disabled)', wrap);
    if (ctl) ctl.focus({ preventScroll: true });
  }

  // Put stored answers into the controls.
  for (const p of passages) for (const g of p.groups) {
    if (g.type === 'multi') {
      const picked = g.nums.map((n) => answers[n]).filter(Boolean);
      for (const cb of $$(`input[data-multi="${g.from}"]`, right)) cb.checked = picked.includes(cb.value);
    } else for (const n of g.nums) {
      const v = answers[n];
      if (!v) continue;
      const ctl = $(`[data-q="${n}"]`, right);
      if (ctl) ctl.value = v;
      else for (const r of $$(`input[name="q${n}"]`, right)) r.checked = r.value === v;
    }
  }

  if (review) {
    for (const ctl of $$('input, select', right)) ctl.disabled = true;
    for (const p of passages) for (const g of p.groups) {
      if (g.type === 'multi') {
        const wrap = $(`[data-wrap="${g.nums.join(' ')}"]`, right);
        const good = g.nums.filter((n) => review.detail[n]?.ok).length;
        wrap.lastElementChild.insertAdjacentHTML('beforeend', `<div class="verdict ${good === g.nums.length ? 'ok' : 'bad'}" style="margin:8px 0 0">${good}/${g.nums.length} correct — answers: ${esc(review.detail[g.from]?.correct || '—')}</div>`);
        continue;
      }
      for (const n of g.nums) {
        const d = review.detail[n];
        const wrap = $(`[data-wrap="${n}"]`, right);
        if (!wrap || !d) continue;
        wrap.classList.add(d.ok ? 'is-ok' : 'is-bad');
        const html = `<span class="verdict ${d.ok ? 'ok' : 'bad'}">${d.ok ? '✓' : `✗ ${d.given ? '' : 'no answer · '}correct: ${esc(d.correct || '—')}`}</span>`;
        if (wrap.classList.contains('q')) wrap.lastElementChild.insertAdjacentHTML('beforeend', `<div style="margin-top:6px">${html}</div>`);
        else wrap.insertAdjacentHTML('beforeend', html);
      }
    }
  }

  const changed = () => {
    paint();
    opts.onChange?.(answers, [...flags]);
  };
  right.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.q) answers[+t.dataset.q] = t.value.trim();
    else if (t.type === 'radio') answers[+t.name.slice(1)] = t.value;
    else if (t.dataset.multi) {
      const g = groupOf(+t.dataset.multi);
      const boxes = $$(`input[data-multi="${g.from}"]`, right);
      if (boxes.filter((b) => b.checked).length > g.pick) {
        t.checked = false;
        toast(`Choose ${g.pick} only — untick one first.`, 2200);
      }
      const picked = boxes.filter((b) => b.checked).map((b) => b.value);
      g.nums.forEach((n, i) => (answers[n] = picked[i] || ''));
    }
    changed();
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, mark.hl');
    if (!t) return;
    if (t.matches('mark.hl')) {
      const parent = t.parentNode;
      t.replaceWith(...t.childNodes);
      parent.normalize();
    } else if (t.dataset.flag) {
      const g = groupOf(+t.dataset.flag);
      const nums = g.type === 'multi' ? g.nums : [+t.dataset.flag];
      const on = !flags.has(nums[0]);
      nums.forEach((n) => (on ? flags.add(n) : flags.delete(n)));
      changed();
    } else if (t.dataset.n) goTo(+t.dataset.n);
    else if (t.dataset.part) show(+t.dataset.part);
    else if (t.id === 'prev' || t.id === 'next') {
      const i = passages.findIndex((p) => p.num === current) + (t.id === 'next' ? 1 : -1);
      if (passages[i]) show(passages[i].num);
    } else if (t.dataset.orig !== undefined || t.dataset.origPassage !== undefined) {
      const scope = t.dataset.orig !== undefined ? t.closest('.group') : t.closest('article');
      const orig = $('.orig', scope);
      orig.hidden = !orig.hidden;
      t.setAttribute('aria-pressed', String(!orig.hidden));
      if (t.dataset.origPassage !== undefined) $('.passage', scope).hidden = !orig.hidden;
      if (!orig.hidden) fillOrig(orig);
    } else if (t.dataset.fs) {
      const fs = Math.min(24, Math.max(13, prefs.get('fs', 16) + +t.dataset.fs));
      prefs.set('fs', fs);
      root.style.setProperty('--fs', fs + 'px');
    }
  });

  // Highlighter: select text in the passage or questions, then press Highlight.
  let pop = null;
  const closePop = () => (pop?.remove(), (pop = null));
  const onSelect = () => {
    closePop();
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const zone = (node.nodeType === 1 ? node : node.parentElement).closest('.hl-zone');
    if (!zone || !root.contains(zone)) return;
    const rect = range.getBoundingClientRect();
    pop = document.createElement('div');
    pop.className = 'hl-pop';
    pop.innerHTML = '<button type="button">Highlight</button>';
    pop.style.left = Math.max(8, Math.min(innerWidth - 110, rect.left + rect.width / 2 - 45)) + 'px';
    pop.style.top = Math.max(8, rect.top - 40) + 'px';
    pop.firstChild.onmousedown = (ev) => {
      ev.preventDefault();
      highlight(range, zone);
      sel.removeAllRanges();
      closePop();
    };
    document.body.append(pop);
  };
  const onMouseUp = (e) => {
    if (e.target.closest?.('.hl-pop')) return;
    setTimeout(onSelect, 0);
  };
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('touchend', onMouseUp);
  left.addEventListener('scroll', closePop);
  right.addEventListener('scroll', closePop);

  // Resizable split.
  const divider = $('#divider');
  divider.addEventListener('pointerdown', (e) => {
    if (innerWidth <= 820) return;
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('drag');
    const move = (ev) => {
      const box = $('.split').getBoundingClientRect();
      const pct = Math.min(75, Math.max(25, ((ev.clientX - box.left) / box.width) * 100));
      $('.split').style.setProperty('--left', pct + '%');
      prefs.set('split', Math.round(pct));
    };
    const up = () => {
      divider.classList.remove('drag');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });

  show(current);
  paint();
  return {
    root, goTo,
    destroy() {
      closePop();
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', onMouseUp);
    },
  };
}

function highlight(range, zone) {
  const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (range.intersectsNode(n) && n.nodeValue.trim() && !n.parentElement.closest('select, option, button, mark.hl, .orig, .verdict')) nodes.push(n);
  }
  for (const n of nodes) {
    const s = n === range.startContainer ? range.startOffset : 0;
    const e = n === range.endContainer ? range.endOffset : n.nodeValue.length;
    if (e <= s) continue;
    const r = document.createRange();
    r.setStart(n, s);
    r.setEnd(n, e);
    const m = document.createElement('mark');
    m.className = 'hl';
    m.title = 'Click to remove highlight';
    r.surroundContents(m);
  }
}

const TOOLS = `<button class="btn small" data-fs="-1" aria-label="Smaller text">A−</button><button class="btn small" data-fs="1" aria-label="Larger text">A+</button><button class="btn small" data-theme-btn>Theme</button>`;

// ---------- live test ----------
async function resumeExam() {
  const session = prefs.get('session', null);
  if (!session) return go('#home');
  const book = await db.get('books', session.bookId);
  const test = book?.tests.find((t) => t.num === session.testNum);
  if (!test) {
    prefs.set('session', null);
    return go('#home');
  }
  const { config, limit } = session;
  const timed = config.timer !== 'none';
  let paused = false;
  let finished = false;
  let last = Date.now();
  let hidden = false;
  const warned = new Set();

  const view = mountExam({
    book, test, passages: session.passages, answers: session.answers, flags: session.flags, review: null,
    barHTML: `<button class="btn small" id="exit">Exit</button><span class="title">${esc(book.title)} · Test ${test.num}</span><span class="spacer"></span>
      ${timed ? '<button class="timer" id="timer" title="Click to hide or show the clock" aria-live="off"></button>' : ''}
      ${TOOLS}${config.pause && timed ? '<button class="btn small" id="pause">Pause</button>' : ''}<button class="btn primary" id="submit">Submit</button>`,
    onChange(answers, flags) {
      session.answers = answers;
      session.flags = flags;
      save();
    },
  });
  const save = () => !finished && prefs.set('session', session);
  const timerEl = $('#timer');

  function tick() {
    const now = Date.now();
    if (!paused) session.elapsed += (now - last) / 1000;
    last = now;
    if (!timerEl) return;
    const left = limit === null ? null : limit - session.elapsed;
    if (left !== null && left <= 0 && config.onEnd === 'submit') return submit(true);
    timerEl.classList.toggle('concealed', hidden);
    timerEl.classList.toggle('low', left !== null && left > 0 && left <= 300);
    timerEl.classList.toggle('over', left !== null && left <= 0);
    timerEl.textContent = hidden ? 'Show clock' : left === null ? clock(session.elapsed) : left > 0 ? clock(Math.ceil(left)) : '+' + clock(-left);
    if (config.warn && left !== null) for (const m of [10, 5]) {
      if (left <= m * 60 && left > m * 60 - 5 && limit > m * 60 + 30 && !warned.has(m)) {
        warned.add(m);
        toast(`${m} minutes left`);
      }
    }
  }
  const interval = setInterval(tick, 250);
  const saver = setInterval(save, 5000);
  tick();

  const onUnload = (e) => {
    save();
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onUnload);
  leaveExam = () => {
    clearInterval(interval);
    clearInterval(saver);
    window.removeEventListener('beforeunload', onUnload);
    view.destroy();
    save();
    leaveExam = null;
  };

  async function submit(auto) {
    if (finished) return;
    finished = true;
    const result = mark(test, session.passages, session.answers);
    const attempt = {
      id: uid(), bookId: book.id, bookTitle: book.title, testNum: test.num, passages: session.passages, config, limit,
      answers: session.answers, flags: session.flags, elapsed: Math.round(session.elapsed), submittedAt: Date.now(), auto,
      raw: result.raw, total: result.total, band: result.band,
    };
    await db.put('attempts', attempt);
    prefs.set('session', null);
    if (auto) toast('Time is up — your answers were submitted.');
    go(`#attempt-${attempt.id}`);
  }

  if (timerEl) timerEl.onclick = () => ((hidden = !hidden), tick());
  $('#submit').onclick = async () => {
    const nums = test.passages.filter((p) => session.passages.includes(p.num)).flatMap((p) => p.groups.flatMap((g) => g.nums));
    const blank = nums.filter((n) => !session.answers[n]);
    const flagged = nums.filter((n) => session.flags.includes(n));
    const ok = await dialog('Submit your answers?', `<p>You have answered <b>${nums.length - blank.length}</b> of <b>${nums.length}</b> questions.</p>
      ${blank.length ? `<p class="small">Unanswered: ${blank.join(', ')}</p>` : ''}${flagged.length ? `<p class="small">Marked for review: ${flagged.join(', ')}</p>` : ''}`,
      [{ label: 'Keep working', value: false }, { label: 'Submit', value: true, kind: 'primary' }]);
    if (ok) submit(false);
  };
  $('#exit').onclick = async () => {
    const choice = await dialog('Leave the test?', '<p>Save it to carry on later from the library, or discard this attempt.</p>',
      [{ label: 'Stay', value: null }, { label: 'Discard', value: 'discard', kind: 'danger' }, { label: 'Save and exit', value: 'save', kind: 'primary' }]);
    if (!choice) return;
    if (choice === 'discard') {
      finished = true;
      prefs.set('session', null);
    }
    go('#home');
  };
  const pauseBtn = $('#pause');
  if (pauseBtn) pauseBtn.onclick = async () => {
    paused = true;
    save();
    $('.split').style.visibility = 'hidden';
    await dialog('Paused', '<p>The clock is stopped and the test is hidden.</p>', [{ label: 'Resume', value: true, kind: 'primary' }]);
    $('.split').style.visibility = '';
    last = Date.now();
    paused = false;
  };
}

// ---------- results ----------
async function loadAttempt(id) {
  const attempt = await db.get('attempts', id);
  if (!attempt) return {};
  const book = await db.get('books', attempt.bookId);
  const test = book?.tests.find((t) => t.num === attempt.testNum);
  return { attempt, book, test };
}

async function resultsView(id) {
  const { attempt, book, test } = await loadAttempt(id);
  if (!attempt) return go('#home');
  const result = test ? mark(test, attempt.passages, attempt.answers) : null;
  if (result && (result.raw !== attempt.raw || result.total !== attempt.total)) {
    Object.assign(attempt, { raw: result.raw, total: result.total, band: result.band }); // the answer key was edited since
    await db.put('attempts', attempt);
  }
  const est = attempt.total !== 40;
  const pct = attempt.total ? Math.round((attempt.raw / attempt.total) * 100) : 0;
  app.innerHTML = `<div class="page">${header()}
    <h1 style="font:700 26px var(--serif)">${esc(attempt.bookTitle)} · Test ${attempt.testNum}</h1>
    <p class="lede">Passage${attempt.passages.length > 1 ? 's' : ''} ${attempt.passages.join(', ')} · submitted ${fmtDate(attempt.submittedAt)}${attempt.auto ? ' (time ran out)' : ''}</p>
    <div class="score">
      <div class="stat band"><small>${est ? 'Estimated band' : 'Band score'}</small><b>${attempt.band.toFixed(1)}</b></div>
      <div class="stat"><small>Correct</small><b>${attempt.raw}<span class="muted" style="font-size:.55em"> / ${attempt.total}</span></b></div>
      <div class="stat"><small>Accuracy</small><b>${pct}%</b></div>
      <div class="stat"><small>Time used</small><b>${clock(attempt.elapsed)}</b>${attempt.limit ? `<div class="small muted">of ${clock(attempt.limit)}</div>` : ''}</div>
    </div>
    ${est ? `<p class="small muted">Band estimated by scaling ${attempt.raw}/${attempt.total} to a full 40-question paper (${result ? result.scaled : Math.round((attempt.raw / attempt.total) * 40)}/40). A full three-passage test gives a truer figure.</p>` : ''}
    <div class="row" style="margin:14px 0 20px">${test ? `<a class="btn primary" href="#attempt-${attempt.id}-review">Review answers in the test</a><a class="btn" href="#book-${attempt.bookId}-test-${attempt.testNum}">Try again</a>` : ''}<a class="btn" href="#home">Library</a></div>
    ${result ? `<div class="card"><h2>By passage</h2><table class="list" style="margin-top:8px"><tbody>
      ${result.perPassage.map((p) => `<tr><td><b>Passage ${p.num}</b> — ${esc(p.title)}</td><td class="num" style="text-align:right">${p.raw} / ${p.total}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h2>Answers</h2><table class="list" style="margin-top:8px"><thead><tr><th>#</th><th>Your answer</th><th>Correct answer</th><th></th></tr></thead><tbody>
      ${Object.keys(result.detail).map(Number).sort((a, b) => a - b).map((n) => {
        const d = result.detail[n];
        return `<tr><td class="num"><b>${n}</b></td><td>${d.given ? esc(d.given) : '<span class="muted">—</span>'}</td><td>${esc(d.correct || '—')}${d.either ? ' <span class="muted small">(either order)</span>' : ''}</td>
          <td><span class="pill ${d.ok ? 'ok' : d.given ? 'bad' : 'none'}">${d.ok ? 'Correct' : d.given ? 'Wrong' : 'Blank'}</span></td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="notice">The book for this attempt has been removed, so the answers cannot be shown.</div>'}
    <details class="card"><summary><b>How the band is worked out</b></summary>
      <p class="small muted">Academic Reading raw score (out of 40) to band. Real papers shift by a mark either way depending on difficulty.</p>
      <table class="list"><thead><tr><th>Raw score</th><th>Band</th></tr></thead><tbody>
      ${BAND_TABLE.filter(([, b]) => b >= 2.5).map(([min, b], i, a) => `<tr><td class="num">${min}${i === 0 ? '–40' : a[i - 1][0] - 1 > min ? '–' + (a[i - 1][0] - 1) : ''}</td><td class="num">${b.toFixed(1)}</td></tr>`).join('')}</tbody></table></details>
  </div>`;
}

async function reviewView(id) {
  const { attempt, book, test } = await loadAttempt(id);
  if (!attempt || !test) return go('#home');
  const result = mark(test, attempt.passages, attempt.answers);
  const view = mountExam({
    book, test, passages: attempt.passages, answers: { ...attempt.answers }, flags: attempt.flags || [], review: { detail: result.detail },
    barHTML: `<a class="btn small" href="#attempt-${attempt.id}">Back to results</a><span class="title">Review · ${esc(book.title)} · Test ${test.num}</span><span class="spacer"></span>
      <span class="pill ok">${result.raw} correct</span><span class="pill bad">${result.total - result.raw} wrong or blank</span>${TOOLS}`,
  });
  leaveExam = () => {
    view.destroy();
    leaveExam = null;
  };
}

route();
