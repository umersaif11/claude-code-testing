/*
 * Renders the client image: satellite crop with roof, obstructions and panels
 * on the left, project summary on the right. Output is 3840 × 2160 (4K UHD).
 * Tiles are drawn onto our own canvas instead of screenshotting the page so
 * the panels stay razor sharp at any size.
 */
(function (root) {
  'use strict';

  const OUT_W = 3840, OUT_H = 2160;
  const MAP_W = 2560;
  const SIDE_X = MAP_W, SIDE_W = OUT_W - MAP_W;
  const TILE = 256, MAX_TILES = 80;
  const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  const C = {
    roof: '#FFD23F', roofHalo: 'rgba(0,0,0,0.55)',
    panel: '#14284B', panelEdge: '#E8EEF7', panelCell: 'rgba(160,190,230,0.35)',
    obstacle: '#E5484D', ink: '#14181F', ink2: '#4A5160', ink3: '#7A8191',
    rule: '#E3E6EC', accent: '#E8A200', side: '#FFFFFF',
  };

  function worldPx(lat, lng, z) {
    const s = TILE * 2 ** z;
    const sin = Math.sin((lat * Math.PI) / 180);
    return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
  }

  function loadTile(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 15000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = url;
    });
  }

  /** Pick the crop (world-pixel rectangle at zoom z) around everything drawn. */
  function chooseView(allLatLngs, maxZoom) {
    for (let z = maxZoom; z >= 1; z--) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [lat, lng] of allLatLngs) {
        const [x, y] = worldPx(lat, lng, z);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      let w = maxX - minX, h = maxY - minY;
      const pad = Math.max(w, h) * 0.3 + 24;
      w += pad * 2; h += pad * 2;
      const aspect = MAP_W / OUT_H;
      if (w / h > aspect) h = w / aspect; else w = h * aspect;
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const view = { z, x: cx - w / 2, y: cy - h / 2, w, h };
      const tiles = (Math.ceil(w / TILE) + 1) * (Math.ceil(h / TILE) + 1);
      if (tiles <= MAX_TILES) return view;
    }
    return null;
  }

  function wrapText(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  function niceScale(metersPerPx, targetPx) {
    const raw = metersPerPx * targetPx;
    const pow = 10 ** Math.floor(Math.log10(raw));
    for (const m of [5, 2, 1]) if (m * pow <= raw) return m * pow;
    return pow;
  }

  function pathPoly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function drawPanel(ctx, p, s) {
    pathPoly(ctx, p);
    ctx.fillStyle = C.panel;
    ctx.fill();
    const [a, b, , d] = p;
    const across = [b[0] - a[0], b[1] - a[1]], depth = [d[0] - a[0], d[1] - a[1]];
    if (Math.hypot(...across) > 14 && Math.hypot(...depth) > 14) {
      ctx.strokeStyle = C.panelCell;
      ctx.lineWidth = Math.max(1, s * 0.6);
      ctx.beginPath();
      const cols = Math.hypot(...across) < Math.hypot(...depth) ? 6 : 12;
      for (let i = 1; i < cols; i++) {
        const f = i / cols;
        ctx.moveTo(a[0] + across[0] * f, a[1] + across[1] * f);
        ctx.lineTo(d[0] + across[0] * f, d[1] + across[1] * f);
      }
      ctx.moveTo(a[0] + depth[0] / 2, a[1] + depth[1] / 2);
      ctx.lineTo(b[0] + depth[0] / 2, b[1] + depth[1] / 2);
      ctx.stroke();
    }
    pathPoly(ctx, p);
    ctx.strokeStyle = C.panelEdge;
    ctx.lineWidth = Math.max(1, s * 0.9);
    ctx.stroke();
  }

  function drawHatch(ctx, pts, s) {
    ctx.save();
    pathPoly(ctx, pts);
    ctx.fillStyle = 'rgba(229,72,77,0.28)';
    ctx.fill();
    ctx.clip();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    ctx.strokeStyle = C.obstacle;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    const step = 12 * s;
    for (let x = x0 - (y1 - y0); x < x1; x += step) { ctx.moveTo(x, y1); ctx.lineTo(x + (y1 - y0), y0); }
    ctx.stroke();
    ctx.restore();
    pathPoly(ctx, pts);
    ctx.strokeStyle = C.obstacle;
    ctx.lineWidth = 3 * s;
    ctx.stroke();
  }

  function drawNorthArrow(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(0, 0, 58 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -38 * s); ctx.lineTo(22 * s, 26 * s); ctx.lineTo(0, 12 * s); ctx.lineTo(-22 * s, 26 * s); ctx.closePath(); ctx.fill();
    ctx.font = `700 ${26 * s}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -42 * s - 4);
    ctx.restore();
  }

  function drawScaleBar(ctx, x, y, metersPerPx, s) {
    const meters = niceScale(metersPerPx, 360 * s);
    const px = meters / metersPerPx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 20 * s, y - 64 * s, px + 40 * s, 92 * s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, px, 8 * s);
    ctx.fillRect(x, y - 12 * s, 4 * s, 20 * s);
    ctx.fillRect(x + px - 4 * s, y - 12 * s, 4 * s, 20 * s);
    ctx.font = `600 ${28 * s}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${meters} m`, x, y - 22 * s);
    ctx.restore();
  }

  function fmt(n, digits = 0) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function compassWord(az) {
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  }

  function drawSidebar(ctx, info, s) {
    ctx.fillStyle = C.side;
    ctx.fillRect(SIDE_X, 0, SIDE_W, OUT_H);
    ctx.fillStyle = C.accent;
    ctx.fillRect(SIDE_X, 0, 16, OUT_H);
    const x = SIDE_X + 120, w = SIDE_W - 200;
    let y = 150;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = C.ink3;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText('ROOFTOP SOLAR PV LAYOUT', x, y);
    y += 96;
    ctx.fillStyle = C.ink;
    ctx.font = `700 76px ${FONT}`;
    for (const line of wrapText(ctx, info.project || 'Solar PV proposal', w).slice(0, 2)) {
      ctx.fillText(line, x, y); y += 90;
    }
    ctx.fillStyle = C.ink2;
    ctx.font = `400 38px ${FONT}`;
    if (info.location) { ctx.fillText(info.location, x, y); y += 54; }
    ctx.fillText(info.date, x, y);
    y += 70;
    ctx.fillStyle = C.rule; ctx.fillRect(x, y, w, 3); y += 110;

    ctx.fillStyle = C.ink2;
    ctx.font = `500 40px ${FONT}`;
    ctx.fillText('System size', x, y);
    y += 150;
    ctx.fillStyle = C.ink;
    ctx.font = `700 150px ${FONT}`;
    const kwp = fmt(info.kwp, info.kwp < 100 ? 2 : 1);
    ctx.fillText(kwp, x, y);
    const kw = ctx.measureText(kwp).width;
    ctx.font = `600 64px ${FONT}`;
    ctx.fillText('kWp', x + kw + 24, y);
    y += 100;

    const tiles = [
      ['Solar panels', `${fmt(info.count)} × ${fmt(info.wattage)} W`],
      ['Yearly generation (est.)', `${fmt(info.yearlyKwh)} kWh`],
      ['Average per day', `${fmt(info.yearlyKwh / 365)} kWh`],
      ['Specific yield', `${fmt(info.specificYield)} kWh/kWp`],
    ];
    const colW = w / 2;
    tiles.forEach(([label, value], i) => {
      const tx = x + (i % 2) * colW, ty = y + Math.floor(i / 2) * 190;
      ctx.fillStyle = C.ink2;
      ctx.font = `500 34px ${FONT}`;
      ctx.fillText(label, tx, ty + 50);
      ctx.fillStyle = C.ink;
      ctx.font = `700 58px ${FONT}`;
      ctx.fillText(value, tx, ty + 124);
    });
    y += 400;
    ctx.fillStyle = C.rule; ctx.fillRect(x, y, w, 3); y += 80;

    ctx.font = `400 34px ${FONT}`;
    const details = [
      ['Mounting', info.mounting],
      ['Tilt / facing', `${fmt(info.tilt)}° · ${info.azimuths.map((az) => `${compassWord(az)} (${fmt(az)}°)`).join(', ')}`],
      ['Roof area', `${fmt(info.roofArea)} m²`],
      ['Sunlight data', info.source],
    ];
    for (const [k, v] of details) {
      ctx.fillStyle = C.ink2; ctx.fillText(k, x, y);
      ctx.fillStyle = C.ink;
      const lines = wrapText(ctx, v, w - 420);
      lines.forEach((l, i) => ctx.fillText(l, x + 420, y + i * 46));
      y += 46 * lines.length + 20;
    }
    y += 40;

    // Legend
    const legend = [['panel', 'Solar panel'], ['roof', 'Roof area'], ['obstacle', 'Obstruction (kept clear)']];
    let lx = x;
    ctx.font = `500 32px ${FONT}`;
    for (const [kind, label] of legend) {
      if (kind === 'obstacle' && !info.hasObstacles) continue;
      if (kind === 'panel') { ctx.fillStyle = C.panel; ctx.fillRect(lx, y - 30, 40, 40); }
      if (kind === 'roof') { ctx.strokeStyle = C.roof; ctx.lineWidth = 6; ctx.strokeRect(lx + 3, y - 27, 34, 34); }
      if (kind === 'obstacle') { ctx.fillStyle = C.obstacle; ctx.fillRect(lx, y - 30, 40, 40); }
      ctx.fillStyle = C.ink;
      ctx.fillText(label, lx + 56, y);
      lx += 56 + ctx.measureText(label).width + 56;
    }

    ctx.fillStyle = C.ink3;
    ctx.font = `400 28px ${FONT}`;
    let fy = OUT_H - 150;
    const note = 'Estimate only. Actual output depends on shading, dust, equipment and weather.';
    for (const l of wrapText(ctx, note, w)) { ctx.fillText(l, x, fy); fy += 40; }
    if (info.preparedBy) { ctx.fillStyle = C.ink2; ctx.font = `600 30px ${FONT}`; ctx.fillText(`Prepared by ${info.preparedBy}`, x, fy + 10); }
  }

  /**
   * @param {object} scene  roofs: [[lat,lng]...][], obstacles: same, panels: [[lat,lng]x4][]
   * @param {object} info   numbers and labels for the summary panel
   * @param {object} imagery  { url: '…/{z}/{y}/{x}', maxZoom, attribution }
   * @returns {Promise<{canvas: HTMLCanvasElement, missingTiles: number}>}
   */
  async function renderClientImage(scene, info, imagery) {
    const all = [...scene.roofs.flat(), ...scene.obstacles.flat()];
    if (!all.length) throw new Error('Draw a roof first.');
    const view = chooseView(all, imagery.maxZoom);
    if (!view) throw new Error('The drawn area is too large to export.');
    const scale = MAP_W / view.w;

    const canvas = document.createElement('canvas');
    canvas.width = OUT_W; canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2B2F36';
    ctx.fillRect(0, 0, MAP_W, OUT_H);

    const n = 2 ** view.z;
    const tx0 = Math.floor(view.x / TILE), tx1 = Math.floor((view.x + view.w) / TILE);
    const ty0 = Math.floor(view.y / TILE), ty1 = Math.floor((view.y + view.h) / TILE);
    const jobs = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        const url = imagery.url.replace('{z}', view.z).replace('{x}', wx).replace('{y}', ty);
        jobs.push(loadTile(url).then((img) => ({ img, tx, ty })));
      }
    }
    const tiles = await Promise.all(jobs);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    let missingTiles = 0;
    for (const { img, tx, ty } of tiles) {
      if (!img) { missingTiles++; continue; }
      const dx = (tx * TILE - view.x) * scale, dy = (ty * TILE - view.y) * scale;
      // Overdraw by a pixel to hide seams between scaled tiles.
      ctx.drawImage(img, Math.floor(dx), Math.floor(dy), Math.ceil(TILE * scale) + 1, Math.ceil(TILE * scale) + 1);
    }

    const toPx = ([lat, lng]) => {
      const [x, y] = worldPx(lat, lng, view.z);
      return [(x - view.x) * scale, (y - view.y) * scale];
    };
    const s = Math.min(2.2, Math.max(1, scale / 2));

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, MAP_W, OUT_H); ctx.clip();
    ctx.lineJoin = 'round';
    for (const roof of scene.roofs) {
      const pts = roof.map(toPx);
      pathPoly(ctx, pts); ctx.strokeStyle = C.roofHalo; ctx.lineWidth = 12; ctx.stroke();
      pathPoly(ctx, pts); ctx.strokeStyle = C.roof; ctx.lineWidth = 6; ctx.stroke();
    }
    for (const ob of scene.obstacles) drawHatch(ctx, ob.map(toPx), Math.max(1, s * 0.8));
    for (const p of scene.panels) drawPanel(ctx, p.map(toPx), s);
    ctx.restore();

    const centerLat = scene.roofs[0][0][0];
    const metersPerPx = (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / 2 ** view.z / scale;
    drawNorthArrow(ctx, 120, 140, 1.2);
    drawScaleBar(ctx, 80, OUT_H - 90, metersPerPx, 1.2);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = `400 24px ${FONT}`;
    const attr = imagery.attribution;
    const aw = ctx.measureText(attr).width;
    ctx.fillRect(MAP_W - aw - 40, OUT_H - 50, aw + 40, 50);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(attr, MAP_W - aw - 20, OUT_H - 17);

    drawSidebar(ctx, info, s);
    return { canvas, missingTiles };
  }

  root.PVExport = { renderClientImage, OUT_W, OUT_H };
})(typeof self !== 'undefined' ? self : this);
