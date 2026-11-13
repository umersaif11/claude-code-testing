// Dev helper: node tools/parse-cli.mjs pages.json [--full]
// Prints a structural summary of what the parser found (text is truncated).
import fs from 'node:fs';
import { parseBook } from '../js/parser.js';

const pages = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const full = process.argv.includes('--full');
const cut = (s, n = 46) => (full || s.length <= n ? s : s.slice(0, n) + '…');
const book = parseBook(pages);
for (const t of book.tests) {
  console.log(`\n# Test ${t.num} — key: ${Object.keys(t.key.answers).length} answers, either-order: ${JSON.stringify(t.key.either)}`);
  for (const p of t.passages) {
    console.log(`\n## Passage ${p.num} [${p.range}] "${cut(p.title)}" sub=${p.subtitle.length} paras=${p.paragraphs.length} labels=${p.paragraphs.map((x) => x.label || '-').join('')} foot=${p.footnotes.length} pages=${p.regions.map((r) => r.page + 1)}`);
    for (const g of p.groups) {
      console.log(`  Q${g.from}-${g.to} ${g.type}${g.pick > 1 ? '×' + g.pick : ''} choices=${g.choices ? g.choices.join('') : 'text'} visual=${g.visual} incomplete=${g.incomplete} pages=${g.regions.map((r) => r.page + 1)}`);
      for (const s of g.instructions) console.log(`     instr: ${cut(s, 70)}`);
      for (const s of g.notes) console.log(`     note: ${cut(s)}`);
      if (g.options.length) console.log(`     options: ${g.options.map((o) => o.label + ':' + o.text.length).join(' ')}`);
      for (const q of g.questions) console.log(`     ${q.n}. ${cut(q.text)} ${q.options.map((o) => o.label + ':' + o.text.length).join(' ')}  => ${t.key.answers[q.n]}`);
      for (const r of g.rows) console.log(`     ${r.title ? 'T' : r.heading ? 'H' : r.bullet ? '•' : ' '} ${cut(r.text, 60)}`);
      if (g.type === 'completion' || g.type === 'multi') console.log(`     key: ${g.nums.map((n) => n + '=' + t.key.answers[n]).join(' | ')}`);
    }
  }
}
console.log('\nWarnings:\n' + book.warnings.map((w) => ' - ' + w).join('\n'));
