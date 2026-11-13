// pdf.js loading, PDF import, and rendering crops of the original pages.
import { extractPages } from './extract.js';
import { parseBook } from './parser.js';
import { db } from './db.js';

let libp;
export function pdfLib() {
  libp ||= import('../vendor/pdfjs/pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return lib;
  });
  return libp;
}

// Books are often split across several PDFs; put the parts in page order using the printed page
// numbers, falling back to the file names.
function orderParts(parts) {
  for (const part of parts) {
    const offsets = [];
    part.pages.forEach((pg, i) => {
      const foot = pg.lines.filter((l) => l.y > pg.height * 0.88 && /^\d{1,3}$/.test(l.text.trim()));
      if (foot.length === 1) offsets.push(+foot[0].text.trim() - i);
    });
    offsets.sort((a, b) => a - b);
    part.first = offsets.length >= 3 ? offsets[offsets.length >> 1] : null;
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  if (parts.every((p) => p.first !== null)) parts.sort((a, b) => a.first - b.first || byName(a, b));
  else parts.sort(byName);
}

export async function importPdfs(files, onStatus) {
  const lib = await pdfLib();
  const parts = [];
  for (const [i, file] of files.entries()) {
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data, verbosity: 0 }).promise;
    const pages = await extractPages(doc, (p, n) => onStatus(`Reading ${file.name} — page ${p} of ${n}` + (files.length > 1 ? ` (file ${i + 1} of ${files.length})` : '')));
    await doc.destroy();
    parts.push({ name: file.name, file, pages });
  }
  orderParts(parts);
  onStatus('Finding passages, questions and answers…');
  const pages = parts.flatMap((p) => p.pages);
  const textLines = pages.reduce((n, p) => n + p.lines.length, 0);
  const { tests, warnings } = parseBook(pages);
  if (textLines < pages.length * 3) {
    warnings.unshift('This PDF has almost no selectable text. It looks like a pure image scan — run it through OCR (for example ocrmypdf, or "Recognise text" in a PDF app) and import it again.');
  }
  const title = parts[0].name.replace(/\.pdf$/i, '').replace(/^[0-9a-f]{6,}-/, '').replace(/[-_]+/g, ' ').replace(/\s*\d+\s+\d+\s*$/, '').trim() || 'Reading tests';
  return {
    title,
    tests,
    warnings,
    parts: parts.map((p) => ({ name: p.name, pages: p.pages.length })),
    blobs: parts.map((p) => p.file),
  };
}

// ----- original page rendering -----

const docs = new Map(); // `${bookId}:${part}` -> Promise<PDFDocumentProxy|null>
const pageCanvases = new Map();

function locate(book, page) {
  let offset = 0;
  for (const [i, part] of book.parts.entries()) {
    if (page < offset + part.pages) return { part: i, pageNo: page - offset + 1 };
    offset += part.pages;
  }
  return null;
}

async function pageCanvas(book, page, scale) {
  const id = `${book.id}:${page}:${scale}`;
  if (!pageCanvases.has(id)) {
    pageCanvases.set(id, (async () => {
      const loc = locate(book, page);
      if (!loc) return null;
      const dk = `${book.id}:${loc.part}`;
      if (!docs.has(dk)) {
        docs.set(dk, (async () => {
          const blob = await db.get('files', dk);
          if (!blob) return null;
          const lib = await pdfLib();
          return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), verbosity: 0 }).promise;
        })());
      }
      const doc = await docs.get(dk);
      if (!doc) return null;
      const pg = await doc.getPage(loc.pageNo);
      const vp = pg.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      return canvas;
    })());
    if (pageCanvases.size > 12) pageCanvases.delete(pageCanvases.keys().next().value);
  }
  return pageCanvases.get(id);
}

// Fills `el` with crops of the scanned pages for the given regions.
export async function showOriginal(el, book, regions) {
  if (el.dataset.filled) return;
  el.dataset.filled = '1';
  el.textContent = 'Loading original page…';
  const scale = 2;
  const out = [];
  for (const r of regions) {
    const full = await pageCanvas(book, r.page, scale);
    if (!full) continue;
    const c = document.createElement('canvas');
    c.width = Math.round((r.x1 - r.x0) * scale);
    c.height = Math.round((r.y1 - r.y0) * scale);
    c.getContext('2d').drawImage(full, r.x0 * scale, r.y0 * scale, c.width, c.height, 0, 0, c.width, c.height);
    out.push(c);
  }
  el.textContent = out.length ? '' : 'The original PDF is not stored in this browser, so the page image is unavailable.';
  el.append(...out);
}
