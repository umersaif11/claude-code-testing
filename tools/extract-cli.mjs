// Dev helper: node tools/extract-cli.mjs out.json a.pdf [b.pdf ...]
// Dumps the positioned lines the parser consumes (run `npm i` first).
import fs from 'node:fs';
import { extractPages } from '../js/extract.js';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const [, , out, ...files] = process.argv;
const all = [];
for (const [fi, file] of files.entries()) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const pages = await extractPages(doc);
  pages.forEach((p, i) => all.push({ ...p, file: fi, pageNo: i + 1 }));
}
fs.writeFileSync(out, JSON.stringify(all));
console.log(`${all.length} pages -> ${out}`);
