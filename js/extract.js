// Turns a pdf.js document into positioned text lines. Works in the browser and in Node.
// A "line" is { text, segs, x, x2, y, h } in viewport points (y grows downward).
// Wide horizontal gaps inside a line are kept as "\t" so the parser can see columns and labels.

const TAB_GAP = 11;

export async function extractPages(doc, onProgress) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const [a, b, c, d, e, f] = vp.transform;
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = it.transform;
      const x = a * t[4] + c * t[5] + e;
      const y = b * t[4] + d * t[5] + f;
      const h = Math.hypot(a * t[2] + c * t[3], b * t[2] + d * t[3]) || it.height || 10;
      items.push({ str: it.str.trim(), x, y, w: it.width, h });
    }
    pages.push({ width: vp.width, height: vp.height, lines: buildLines(items) });
    page.cleanup();
    if (onProgress) onProgress(p, doc.numPages);
  }
  return pages;
}

function buildLines(items) {
  items.sort((p, q) => p.y - q.y || p.x - q.x);
  const rows = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.y - row.y) <= Math.max(3, 0.4 * Math.min(it.h, row.h))) {
      row.items.push(it);
    } else {
      rows.push({ y: it.y, h: it.h, items: [it] });
    }
  }
  return rows.map((row) => {
    row.items.sort((p, q) => p.x - q.x);
    let text = '';
    let end = null;
    const hs = [];
    const segs = [];
    for (const it of row.items) {
      const gap = end === null ? Infinity : it.x - end;
      if (gap > TAB_GAP) segs.push({ x: it.x, text: '' });
      const sep = end === null ? '' : gap > TAB_GAP ? '\t' : gap > 0.8 ? ' ' : '';
      text += sep + it.str;
      segs[segs.length - 1].text += (sep === ' ' ? ' ' : '') + it.str;
      end = it.x + it.w;
      hs.push(it.h);
    }
    hs.sort((p, q) => p - q);
    return { text, segs, x: row.items[0].x, x2: end, y: row.y, h: hs[hs.length >> 1] };
  });
}
