# PV segment labels (NSITC L5 blue line)

Rebuilds `PV_SEGMENT_LABELS_L5.lsp` from the layout LISP `PV_LAYOUT_L5_BLUE_LINE.lsp`.

```
pip install shapely
python3 seg_find.py PV_LAYOUT_L5_BLUE_LINE.lsp segs.json   # find segments, place labels
python3 seg_lisp.py segs.json PV_SEGMENT_LABELS_L5.lsp      # write the AutoLISP file
```

A segment is one unbroken run of tables. A gap of more than 2 ft between neighbouring tables
starts a new segment (inside a run the joints are 20 mm; the real breaks are 37 ft or more).
