# Reading Lab

A self-hosted practice site for the **IELTS Academic Reading** paper. You give it a PDF of
practice tests; it pulls out the passages, the questions and the answer key, and turns each test
into an on-screen reading section with a timer, marking and a band score.

No test content ships with this repository. Books are read **in your browser** from PDFs you
own, and stay in that browser's storage. Nothing is uploaded anywhere.

## Run it

It is a static site with no build step. It has to be served over HTTP (browsers block JavaScript
modules on `file://`):

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Any static host works too (GitHub Pages, Netlify, …).

## Use it

1. **Import** – drop the book's PDF on the home page. If the book is split across several files,
   drop them all together; they are put in page order automatically.
2. **Check the import** – you see each test, its passages, question sets and how many answers
   were found in the key. Name the book and save it.
3. **Set up a test** – pick any combination of passages 1–3, then a timer:
   exam timing (20 minutes per passage), a custom countdown, a stopwatch, or none. Choose whether
   the test submits itself when time runs out, whether pausing is allowed, and time warnings.
4. **Take the test** – passage on the left, questions on the right, question navigator along the
   bottom. Click a question number badge to mark it for review, select text to highlight it,
   resize the panes, change text size and theme. Progress is saved if you close the tab.
5. **Submit** – you get the score, the band, time used, a per-passage breakdown, every answer
   against the key, and a review mode that shows right and wrong answers inside the test.

Each passage and question set has an **Original page** button that shows the scanned page from
your PDF. Tables and diagrams are shown that way by default, with answer boxes underneath, since
their layout does not survive as plain text.

If the key was misread anywhere, fix it under **Answer key** in the library; past results are
re-marked. **Export** saves a parsed book as JSON (without the PDF) for moving between browsers.

## What PDFs work

- The PDF needs **selectable text**. A pure image scan must be OCR'd first
  (for example `ocrmypdf in.pdf out.pdf`).
- The parser looks for the structure used by the Cambridge IELTS Academic books:
  `READING PASSAGE 1–3` headings, `Questions 1–13` group headings, the usual instruction wording
  (True/False/Not Given, Yes/No/Not Given, multiple choice, choose TWO, matching, and
  note/summary/sentence/table/flow-chart completion), and a `READING` answer-key section.
  It was developed against Cambridge IELTS 21; other volumes share the layout but have not each
  been checked, so look over the import summary.
- General Training reading sections are laid out differently and are not supported.

## Band scores

Raw scores out of 40 use the commonly published Academic Reading conversion (39–40 → 9,
37–38 → 8.5, 35–36 → 8, 33–34 → 7.5, 30–32 → 7, 27–29 → 6.5, 23–26 → 6, 19–22 → 5.5, 15–18 → 5,
…). Real papers vary by a mark either way. When you practise fewer than three passages the
score is scaled to 40 and the band is labelled as an estimate.

## Code map

| File | Role |
| --- | --- |
| `js/extract.js` | pdf.js text items → positioned lines |
| `js/parser.js` | lines → tests, passages, question groups, answer keys |
| `js/scoring.js` | marking (alternatives, optional words, either-order pairs) and bands |
| `js/pdf.js` | PDF import and rendering crops of the original pages |
| `js/db.js` | IndexedDB / localStorage |
| `js/app.js` | all screens |
| `vendor/pdfjs/` | pdf.js 4.10.38 (Apache-2.0) |

Parser development helpers (need `npm install`):

```bash
node tools/extract-cli.mjs pages.json book-part1.pdf book-part2.pdf
```

```bash
node tools/parse-cli.mjs pages.json
```
