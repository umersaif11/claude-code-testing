import json, math, re, sys
S = json.load(open(sys.argv[1])); OUT = sys.argv[2]
H1, H2 = 7.0, 5.5
def q(s): return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
defs = []
for s in S:
    pts = ' '.join(f'(list {x:.4f} {y:.4f})' for x, y in s['outline'])
    defs.append(f'''(defun pvSeg{s['n']:02d} ()
  (pvSegPL (list {pts}))
  (pvSegT {q(s['l1'])} (list {s['p1'][0]:.4f} {s['p1'][1]:.4f}) {s['ang']:.8f} {H1})
  (pvSegT {q(s['l2'])} (list {s['p2'][0]:.4f} {s['p2'][1]:.4f}) {s['ang']:.8f} {H2}))''')
X0, Y0, dy = 1482100.0, 11416420.0, 37.4
COLS = [0, 130, 900, 1180, 1430, 1680]
def row(cells, y, h=22.0):
    return [f'  (pvSegTL {q(t)} {X0 + COLS[i]:.2f} {y:.2f} {h:.2f})' for i, t in enumerate(cells) if t]
tl = [f'  (pvSegTL {q("SOLAR PV L5 - MODULES PER SEGMENT (NEW SEGMENT WHERE THE PANEL RUN IS BROKEN)")} {X0:.2f} {Y0:.2f} 30.80)']
y = Y0 - 45; tl += row(['SEG', 'AREA / RUN', 'MODULES', 'TABLES', 'kWp', 'LENGTH'], y)
for s_ in S:
    y -= dy
    nm = s_['zone'] + (' (' + s_['part'][1:-1].replace(' OF ', '/') + ')' if s_['part'] else '')
    tl += row([f"{s_['n']:02d}", nm, str(s_['modules']), str(s_['tables']), f"{s_['kwp']:.1f}", f"~{s_['length']:.0f} FT"], y)
tot = sum(s_['modules'] for s_ in S)
y -= dy; tl += row(['', f'TOTAL ({len(S)} SEGMENTS)', f'{tot:,}', f'{tot // 5:,}', f'{tot * 0.62:,.1f}', ''], y)
yb = y - 30
frame = f'  (pvSegPL (list (list {X0 - 44:.2f} {Y0 + 55:.2f}) (list {X0 + 1985.5:.2f} {Y0 + 55:.2f}) (list {X0 + 1985.5:.2f} {yb:.2f}) (list {X0 - 44:.2f} {yb:.2f})))'
summ = ' | '.join(f"SEG {s['n']:02d}: {s['modules']}" for s in S)
nl = '\\n'
lisp = f''';;; PV_SEGMENT_LABELS_L5.lsp - segment labels for the NSITC L5 blue-line PV layout (PV_LAYOUT_L5_BLUE_LINE.lsp, 6915 modules).
;;; A segment is one unbroken run of tables (20 mm joints). Wherever the run is broken (gap > 2 ft; the real breaks are 37 ft or more) a new segment starts.
;;; Command PVSEGMENTS -> {len(S)} segments: segment outline + 2-line label (segment no., area, modules, tables, kWp) + a per-segment table east of the site.
;;; Layers PV-SEG-OUTLINE and PV-SEG-TEXT (magenta). Re-running erases only these two layers; PVLAYOUT and the panels are not touched. One U undoes it.
(defun pvSegLayer (n c)
  (if (not (tblsearch "LAYER" n))
    (entmake (list (cons 0 "LAYER") (cons 100 "AcDbSymbolTableRecord") (cons 100 "AcDbLayerTableRecord")
                   (cons 2 n) (cons 70 0) (cons 62 c) (cons 6 "Continuous")))))
(defun pvSegPL (pts)
  (entmake (append (list (cons 0 "LWPOLYLINE") (cons 100 "AcDbEntity") (cons 8 "PV-SEG-OUTLINE") (cons 100 "AcDbPolyline")
                         (cons 90 (length pts)) (cons 70 1) (cons 43 0.5))
                   (mapcar '(lambda (p) (list 10 (car p) (cadr p))) pts))))
(defun pvSegT (s p r h)
  (entmake (list (cons 0 "TEXT") (cons 8 "PV-SEG-TEXT") (list 10 (car p) (cadr p) 0.0) (list 11 (car p) (cadr p) 0.0)
                 (cons 40 h) (cons 1 s) (cons 50 r) (cons 72 1) (cons 73 2))))
(defun pvSegTL (s x y h)
  (entmake (list (cons 0 "TEXT") (cons 8 "PV-SEG-TEXT") (list 10 x y 0.0) (cons 40 h) (cons 1 s) (cons 50 0.0))))
{chr(10).join(defs)}
(defun pvSegTable ()
{frame}
{chr(10).join(tl)})
(defun c:PVSEGMENTS ( / oldcmd olderr ss n)
  (setq oldcmd (getvar "CMDECHO")) (setvar "CMDECHO" 0)
  (setq olderr *error*)
  (defun *error* (msg) (command "_.UNDO" "_E") (setvar "CMDECHO" oldcmd) (setq *error* olderr)
    (princ (strcat "{nl}PVSEGMENTS error: " msg)) (princ))
  (command "_.UNDO" "_BE")
  (if (setq ss (ssget "_X" '((8 . "PV-SEG-OUTLINE,PV-SEG-TEXT")))) (command "_.ERASE" ss ""))
  (pvSegLayer "PV-SEG-OUTLINE" 6) (pvSegLayer "PV-SEG-TEXT" 6)
  {' '.join(f"(pvSeg{s['n']:02d})" for s in S)}
  (pvSegTable)
  (command "_.UNDO" "_E")
  (setvar "CMDECHO" oldcmd) (setq *error* olderr)
  (setq n (if (setq ss (ssget "_X" '((0 . "INSERT") (8 . "PV-MODULES")))) (sslength ss) 0))
  (if (/= n {tot})
    (princ (strcat "{nl}NOTE: layer PV-MODULES has " (itoa n) " panels, the labels are for the {tot}-panel L5 layout. Run PVLAYOUT from PV_LAYOUT_L5_BLUE_LINE.lsp first.")))
  (princ "{nl}PVSEGMENTS labelled {len(S)} segments, {tot} modules.  {summ}")
  (princ))
(princ "{nl}PV segment labels loaded. Command: PVSEGMENTS")
(princ)
'''
sys.path.insert(0, '.')
def lint(s):
    d = 0; ins = False; i = 0; qd = None; bad = []
    while i < len(s):
        ch = s[i]
        if ins:
            if ch == '\\': i += 1
            elif ch == '"': ins = False
        elif ch == '"': ins = True
        elif ch == ';':
            while i < len(s) and s[i] != '\n': i += 1
        elif ch == '(':
            if s[i-1] == "'" and qd is None: qd = d
            d += 1
            if qd is None and re.match(r'\(\s*-?\d', s[i:i+4]): bad.append(s[max(0, i-30):i+30])
        elif ch == ')':
            d -= 1
            if qd is not None and d == qd: qd = None
            assert d >= 0, i
        i += 1
    assert d == 0 and not ins, (d, ins)
    assert not bad, bad[0]
lint(lisp)
open(OUT, 'w', newline='\r\n').write(lisp); print('ok', len(lisp))
