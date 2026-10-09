/* global L, PVLayout, PVEnergy, PVExport */
(function () {
  'use strict';

  const IMAGERY = {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  };
  const STORAGE_KEY = 'pv-roof-planner-v1';
  const $ = (id) => document.getElementById(id);

  // ---------- State ----------
  const state = {
    roofs: [],        // { latlngs: [[lat,lng]...], removed: Set<string>, result }
    obstacles: [],    // [[lat,lng]...]
    history: [],      // roofs / obstacles in the order they were added, for Undo
    draw: null,       // { kind, pts, line, markers }
    pin: null,        // [lat, lng] from the coordinates box
    city: '',
    sun: null,        // { ghi, source, lat, lng }
  };

  // ---------- Map ----------
  const map = L.map('map', { zoomControl: true, maxZoom: 22 }).setView([30.3753, 69.3451], 5);
  const satellite = L.tileLayer(IMAGERY.url, {
    maxNativeZoom: 19, maxZoom: 22, attribution: IMAGERY.attribution, crossOrigin: 'anonymous',
  }).addTo(map);
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19, maxZoom: 22, attribution: '© OpenStreetMap contributors',
  });
  const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 19, maxZoom: 22, pane: 'overlayPane',
  });
  L.control.layers({ Satellite: satellite, Streets: streets }, { 'Place names': labels }, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);

  const renderer = L.canvas({ padding: 0.3, tolerance: 2 });
  const roofLayer = L.layerGroup().addTo(map);
  const obstacleLayer = L.layerGroup().addTo(map);
  const panelLayer = L.layerGroup().addTo(map);
  const handleLayer = L.layerGroup().addTo(map);
  const drawLayer = L.layerGroup().addTo(map);
  let pinMarker = null;

  // ---------- Helpers ----------
  let toastTimer = null;
  function toast(msg, ms = 4500) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function fmt(n, digits = 0) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  const toLL = (ll) => [ll.lat, ll.lng];

  /** Accepts "31.52, 74.35", DMS like 31°31'13"N 74°21'31"E, or a Google Maps URL. */
  function parseCoords(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const at = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || s.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (at) return valid([+at[1], +at[2]]);
    const dms = [...s.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″]|''))?\s*([NSEW])/gi)];
    if (dms.length === 2) {
      const v = dms.map((m) => {
        let d = +m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600;
        if (/[SW]/i.test(m[4])) d = -d;
        return { d, lat: /[NS]/i.test(m[4]) };
      });
      const lat = v.find((x) => x.lat), lng = v.find((x) => !x.lat);
      if (lat && lng) return valid([lat.d, lng.d]);
    }
    const nums = s.match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length === 2) return valid([+nums[0], +nums[1]]);
    return null;
    function valid([a, b]) { return Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null; }
  }

  // ---------- Options ----------
  function readOptions() {
    const num = (id) => parseFloat($(id).value);
    const mounting = $('mounting').value;
    return {
      wattage: num('wattage') || 0,
      panelLength: (num('panel-length') || 0) / 1000,
      panelWidth: (num('panel-width') || 0) / 1000,
      orientation: $('orientation').value,
      mounting,
      tilt: Math.min(60, Math.max(0, num('tilt') || 0)),
      azimuth: $('azimuth-mode').value === 'manual' ? ((num('azimuth') || 0) % 360 + 360) % 360 : null,
      rowsPerTable: +$('rows-per-table').value,
      setback: Math.max(0, num('setback') || 0),
      obstacleClearance: Math.max(0, num('clearance') || 0),
      rowGap: $('row-gap').value === '' ? null : Math.max(0, num('row-gap')),
      pr: Math.min(0.95, Math.max(0.5, num('pr') || 0.77)),
    };
  }

  function updateModuleHint() {
    const w = parseFloat($('wattage').value);
    const m = w ? PVEnergy.moduleSizeForWattage(w) : null;
    const L_ = parseFloat($('panel-length').value) / 1000, W_ = parseFloat($('panel-width').value) / 1000;
    $('module-hint').textContent = m && L_ && W_
      ? `Module area ${fmt(L_ * W_, 2)} m². Size filled in for a typical ${m.label} module; edit it to match your datasheet.`
      : '';
  }

  function updateMountUi() {
    const flush = $('mounting').value === 'flush';
    document.querySelectorAll('.tilted-only').forEach((el) => { el.hidden = flush; });
    $('azimuth-wrap').hidden = $('azimuth-mode').value !== 'manual';
  }

  // ---------- Layout & results ----------
  let layoutQueued = false;
  function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; runLayout(); });
  }

  function runLayout() {
    const opts = readOptions();
    for (const roof of state.roofs) {
      const obstaclesHere = state.obstacles;
      roof.result = PVLayout.layoutRoof(roof.latlngs, obstaclesHere, { ...opts, removed: roof.removed });
    }
    drawScene();
    updateResults();
    renderLists();
    save();
  }

  function computeTotals() {
    const opts = readOptions();
    let count = 0, kwh = 0, area = 0;
    const ghi = state.sun ? state.sun.ghi : null;
    for (const roof of state.roofs) {
      const r = roof.result;
      if (!r) continue;
      count += r.count;
      area += r.roofArea;
      if (ghi && r.count) {
        const lat = PVLayout.centroid(roof.latlngs)[0];
        const sy = PVEnergy.specificYield({ ghi, lat, tilt: opts.tilt, azimuth: r.azimuth, pr: opts.pr });
        kwh += (r.count * opts.wattage / 1000) * sy;
      }
    }
    const kwp = count * opts.wattage / 1000;
    return { count, kwp, kwh, area, specificYield: kwp ? kwh / kwp : 0, opts };
  }

  function updateResults() {
    const t = computeTotals();
    $('r-kwp').textContent = fmt(t.kwp, t.kwp < 100 ? 2 : 1);
    $('r-count').textContent = fmt(t.count);
    $('r-kwh').textContent = state.sun ? fmt(t.kwh) : '–';
    $('r-yield').textContent = state.sun && t.kwp ? fmt(t.specificYield) : '–';
    $('r-source').textContent = state.sun
      ? `Sunlight ${fmt(state.sun.ghi, 2)} kWh/m²/day · ${state.sun.source}`
      : 'Set a location to estimate generation.';
    $('export').disabled = !state.roofs.length;

    const g = state.roofs.find((r) => r.result && r.result.geometry)?.result.geometry;
    const hint = [];
    if (g && t.opts.mounting === 'tilted') {
      hint.push(`Row gap ${fmt(g.rowGap, 2)} m${t.opts.rowGap == null ? ' (auto: no shading at noon on 21 Dec)' : ''}; structure depth ${fmt(g.tableDepth, 2)} m, height ${fmt(g.tableHeight, 2)} m.`);
    }
    hint.push('Tip: click a panel on the map to remove it, click again to bring it back.');
    $('mount-hint').textContent = state.roofs.length ? hint.join(' ') : '';
  }

  function drawScene() {
    roofLayer.clearLayers();
    obstacleLayer.clearLayers();
    panelLayer.clearLayers();
    handleLayer.clearLayers();

    state.roofs.forEach((roof, ri) => {
      L.polygon(roof.latlngs, {
        color: '#FFD23F', weight: 3, fill: true, fillOpacity: 0.06, interactive: false,
      }).addTo(roofLayer);
      for (const p of roof.result ? roof.result.panels : []) {
        const poly = L.polygon(p.corners, p.removed
          ? { renderer, color: '#FFFFFF', weight: 1, dashArray: '3 3', fillColor: '#14284B', fillOpacity: 0.15 }
          : { renderer, color: '#E8EEF7', weight: 0.8, fillColor: '#14284B', fillOpacity: 0.92 });
        poly.on('click', (e) => {
          if (state.draw) return;
          L.DomEvent.stop(e);
          if (roof.removed.has(p.id)) roof.removed.delete(p.id); else roof.removed.add(p.id);
          runLayout();
        });
        poly.addTo(panelLayer);
      }
      addHandles(roof.latlngs, 'roof', ri);
    });
    state.obstacles.forEach((ob, oi) => {
      L.polygon(ob, { color: '#E5484D', weight: 2, fillColor: '#E5484D', fillOpacity: 0.3, interactive: false }).addTo(obstacleLayer);
      addHandles(ob, 'obstacle', oi);
    });
  }

  function addHandles(latlngs, kind, index) {
    if (state.draw) return;
    latlngs.forEach((ll, vi) => {
      const m = L.marker(ll, {
        draggable: true,
        icon: L.divIcon({ className: `vertex-handle ${kind === 'obstacle' ? 'obstacle' : ''}`, iconSize: null }),
        keyboard: false,
      });
      m.on('drag', (e) => {
        latlngs[vi] = toLL(e.target.getLatLng());
        if (kind === 'roof') state.roofs[index].removed.clear();
        else state.roofs.forEach((r) => r.removed.clear());
        scheduleLayoutKeepHandles();
      });
      m.on('dragend', () => runLayout());
      m.addTo(handleLayer);
    });
  }

  // While dragging, redraw outlines and panels but leave the handle being dragged alone.
  let dragQueued = false;
  function scheduleLayoutKeepHandles() {
    if (dragQueued) return;
    dragQueued = true;
    requestAnimationFrame(() => {
      dragQueued = false;
      const opts = readOptions();
      roofLayer.clearLayers(); obstacleLayer.clearLayers(); panelLayer.clearLayers();
      for (const roof of state.roofs) {
        roof.result = PVLayout.layoutRoof(roof.latlngs, state.obstacles, { ...opts, removed: roof.removed });
        L.polygon(roof.latlngs, { color: '#FFD23F', weight: 3, fillOpacity: 0.06, interactive: false }).addTo(roofLayer);
        for (const p of roof.result.panels) {
          L.polygon(p.corners, { renderer, color: '#E8EEF7', weight: 0.8, fillColor: '#14284B', fillOpacity: 0.92, interactive: false }).addTo(panelLayer);
        }
      }
      for (const ob of state.obstacles) {
        L.polygon(ob, { color: '#E5484D', weight: 2, fillColor: '#E5484D', fillOpacity: 0.3, interactive: false }).addTo(obstacleLayer);
      }
      updateResults();
    });
  }

  function renderLists() {
    const list = $('roof-list');
    list.innerHTML = '';
    const opts = readOptions();
    state.roofs.forEach((roof, i) => {
      const r = roof.result || { count: 0, roofArea: 0, azimuth: 0 };
      const li = document.createElement('li');
      li.innerHTML = `<span class="swatch" style="background:#FFD23F"></span>
        <span class="grow"><b>Roof ${i + 1}</b> · ${fmt(r.roofArea)} m² · ${fmt(r.count)} panels · ${fmt(r.count * opts.wattage / 1000, 2)} kWp · faces ${fmt(r.azimuth)}°</span>`;
      li.appendChild(removeButton(() => {
        state.roofs.splice(i, 1);
        runLayout();
      }, `Remove roof ${i + 1}`));
      list.appendChild(li);
    });
    state.obstacles.forEach((ob, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="swatch" style="background:#E5484D"></span>
        <span class="grow"><b>Obstruction ${i + 1}</b> · ${fmt(PVLayout.polygonArea(ob), 1)} m²</span>`;
      li.appendChild(removeButton(() => { state.obstacles.splice(i, 1); clearRemovals(); runLayout(); }, `Remove obstruction ${i + 1}`));
      list.appendChild(li);
    });
  }

  function removeButton(onClick, label) {
    const b = document.createElement('button');
    b.className = 'btn small danger';
    b.textContent = 'Remove';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function clearRemovals() { state.roofs.forEach((r) => r.removed.clear()); }

  // ---------- Drawing ----------
  function startDraw(kind) {
    if (state.draw) cancelDraw();
    state.draw = { kind, pts: [], line: null };
    $('map').classList.add('drawing');
    $(kind === 'roof' ? 'draw-roof' : 'draw-obstacle').classList.add('active');
    handleLayer.clearLayers();
    updateDrawBanner();
    $('draw-banner').hidden = false;
    if (map.getZoom() < 17) toast('Zoom in close to the roof before drawing for best accuracy.');
  }

  function updateDrawBanner() {
    const d = state.draw;
    if (!d) return;
    const what = d.kind === 'roof' ? 'roof' : 'obstruction';
    $('draw-text').textContent = d.pts.length < 3
      ? `Click the corners of the ${what} (${d.pts.length} so far).`
      : `Click the first point or Finish to close the ${what}. Backspace undoes a point.`;
    $('draw-finish').disabled = d.pts.length < 3;
  }

  function redrawDraft() {
    drawLayer.clearLayers();
    const d = state.draw;
    if (!d) return;
    const color = d.kind === 'roof' ? '#FFD23F' : '#E5484D';
    if (d.pts.length > 1) L.polyline(d.pts, { color, weight: 3, dashArray: '6 4', interactive: false }).addTo(drawLayer);
    d.pts.forEach((p, i) => {
      const m = L.marker(p, {
        icon: L.divIcon({ className: `draw-point ${i === 0 ? 'first' : ''}`, iconSize: null }),
        keyboard: false, interactive: i === 0,
      });
      if (i === 0) m.on('click', (e) => { L.DomEvent.stop(e); if (d.pts.length >= 3) finishDraw(); });
      m.addTo(drawLayer);
    });
  }

  function finishDraw() {
    const d = state.draw;
    if (!d || d.pts.length < 3) return;
    if (d.kind === 'roof') {
      const roof = { latlngs: d.pts.slice(), removed: new Set(), result: null };
      state.roofs.push(roof);
      state.history.push(roof);
      if (!state.sun) refreshSunlight(PVLayout.centroid(d.pts));
    } else {
      const ob = d.pts.slice();
      state.obstacles.push(ob);
      state.history.push(ob);
      clearRemovals();
    }
    endDraw();
    runLayout();
  }

  function cancelDraw() { endDraw(); drawScene(); }

  function endDraw() {
    state.draw = null;
    drawLayer.clearLayers();
    $('map').classList.remove('drawing');
    $('draw-roof').classList.remove('active');
    $('draw-obstacle').classList.remove('active');
    $('draw-banner').hidden = true;
  }

  map.on('click', (e) => {
    if (!state.draw) return;
    state.draw.pts.push(toLL(e.latlng));
    redrawDraft();
    updateDrawBanner();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modal').hidden) { $('modal').hidden = true; return; }
    if (!state.draw || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'Escape') cancelDraw();
    else if (e.key === 'Enter') finishDraw();
    else if (e.key === 'Backspace') {
      e.preventDefault();
      state.draw.pts.pop();
      redrawDraft();
      updateDrawBanner();
    }
  });

  // ---------- Location & sunlight ----------
  async function refreshSunlight([lat, lng], cityName) {
    const city = PVEnergy.findCity(cityName) || PVEnergy.nearestCity(lat, lng);
    state.sun = city
      ? { ghi: city.ghi, source: `${city.name} city average (built-in)`, lat, lng }
      : { ghi: PVEnergy.latitudeGhiEstimate(lat), source: 'rough estimate from latitude', lat, lng };
    updateResults();
    renderLists();
    const nasa = await PVEnergy.fetchNasaGhi(lat, lng);
    if (nasa && state.sun && state.sun.lat === lat && state.sun.lng === lng) {
      state.sun = { ghi: nasa, source: 'NASA POWER long-term average for this site', lat, lng };
      updateResults();
      save();
    }
  }

  function setPin(ll) {
    state.pin = ll;
    if (pinMarker) pinMarker.remove();
    pinMarker = L.marker(ll, { icon: L.divIcon({ className: 'pin', html: '📍', iconSize: null }), interactive: false }).addTo(map);
  }

  function goToCoords() {
    const ll = parseCoords($('coords').value);
    if (!ll) { toast('Could not read those coordinates. Try a format like 31.5204, 74.3587.'); return; }
    setPin(ll);
    map.setView(ll, 20);
    refreshSunlight(ll, $('city').value);
    if (!state.roofs.length) toast('Now click "Draw roof" (or "Detect outline") and outline the roof.');
    save();
  }

  async function goToCity() {
    const name = $('city').value.trim();
    if (!name) return;
    state.city = name;
    const known = PVEnergy.findCity(name);
    let ll = known ? [known.lat, known.lng] : null;
    if (!ll) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`, { headers: { Accept: 'application/json' } });
        const hit = (await res.json())[0];
        if (hit) ll = [+hit.lat, +hit.lon];
      } catch { /* offline: fall through */ }
    }
    if (!ll) { toast(`Could not find "${name}". Check the spelling or enter coordinates.`); return; }
    if (!state.pin) map.setView(ll, 13);
    refreshSunlight(state.pin || ll, name);
    save();
  }

  // ---------- Building outline from OpenStreetMap ----------
  async function detectRoof() {
    const at = state.pin || toLL(map.getCenter());
    if (map.getZoom() < 16 && !state.pin) { toast('Zoom in on the building (or enter its coordinates) first.'); return; }
    const btn = $('detect-roof');
    btn.disabled = true;
    btn.textContent = 'Searching…';
    try {
      const q = `[out:json][timeout:20];way["building"](around:40,${at[0]},${at[1]});out geom;`;
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const data = await res.json();
      const ways = (data.elements || []).filter((w) => w.geometry && w.geometry.length >= 4);
      if (!ways.length) { toast('No building outline found in OpenStreetMap here. Use "Draw roof" and click the corners.'); return; }
      const proj = PVLayout.makeProjection(at[0], at[1]);
      const polys = ways.map((w) => {
        const pts = w.geometry.map((g) => [g.lat, g.lon]);
        if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        return pts;
      });
      const here = proj.toXY(at);
      const hit = polys.find((p) => PVLayout.pointInPolygon(here, p.map(proj.toXY))) ||
        polys.sort((a, b) => dist(a) - dist(b))[0];
      function dist(p) { const c = proj.toXY(PVLayout.centroid(p)); return Math.hypot(c[0] - here[0], c[1] - here[1]); }
      const roof = { latlngs: hit, removed: new Set(), result: null };
      state.roofs.push(roof);
      state.history.push(roof);
      if (!state.sun) refreshSunlight(PVLayout.centroid(hit), $('city').value);
      map.fitBounds(L.latLngBounds(hit), { maxZoom: 20, padding: [60, 60] });
      runLayout();
      toast('Roof outline added from OpenStreetMap. Drag the yellow corners to fine-tune it.');
    } catch {
      toast('Could not reach OpenStreetMap. Draw the roof by clicking its corners instead.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Detect outline';
    }
  }

  // ---------- Export ----------
  async function exportImage() {
    if (!state.roofs.length) return;
    const t = computeTotals();
    const modal = $('modal'), body = $('modal-body'), dl = $('download');
    body.textContent = 'Rendering the 4K image… this takes a few seconds while the satellite tiles download.';
    dl.hidden = true;
    modal.hidden = false;
    const azs = state.roofs.map((r) => r.result?.azimuth ?? 180);
    const location = [state.city || PVEnergy.nearestCity(...PVLayout.centroid(state.roofs[0].latlngs), 80)?.name,
      PVLayout.centroid(state.roofs[0].latlngs).map((v) => v.toFixed(5)).join(', ')].filter(Boolean).join(' · ');
    const scene = {
      roofs: state.roofs.map((r) => r.latlngs),
      obstacles: state.obstacles,
      panels: state.roofs.flatMap((r) => (r.result ? r.result.panels.filter((p) => !p.removed).map((p) => p.corners) : [])),
    };
    const info = {
      project: $('project').value.trim(),
      preparedBy: $('prepared-by').value.trim(),
      location,
      date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      kwp: t.kwp, count: t.count, wattage: t.opts.wattage,
      yearlyKwh: t.kwh, specificYield: t.specificYield,
      mounting: t.opts.mounting === 'flush' ? 'Flush on sloped roof' : `Tilted structures, ${t.opts.rowsPerTable} panel${t.opts.rowsPerTable > 1 ? 's' : ''} deep`,
      tilt: t.opts.tilt, azimuths: [...new Set(azs.map((a) => Math.round(a)))], roofArea: t.area,
      source: state.sun ? state.sun.source : 'not set',
      hasObstacles: state.obstacles.length > 0,
    };
    try {
      const { canvas, missingTiles } = await PVExport.renderClientImage(scene, info, {
        ...IMAGERY, maxZoom: +$('detail').value,
      });
      const blob = await new Promise((res, rej) => {
        try { canvas.toBlob((b) => (b ? res(b) : rej(new Error('empty'))), 'image/png'); } catch (err) { rej(err); }
      });
      const url = URL.createObjectURL(blob);
      body.innerHTML = '';
      if (missingTiles) {
        const p = document.createElement('p');
        p.textContent = `${missingTiles} satellite tile(s) did not load, so parts of the background may be grey. Try "Standard" imagery detail or export again.`;
        body.appendChild(p);
      }
      const img = new Image();
      img.alt = 'Solar layout preview';
      img.src = url;
      body.appendChild(img);
      const safe = (info.project || 'solar-layout').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'solar-layout';
      dl.href = url;
      dl.download = `${safe}-${fmt(t.kwp, 1).replace(/,/g, '')}kWp.png`;
      dl.hidden = false;
    } catch (err) {
      body.textContent = err && err.name === 'SecurityError'
        ? 'The browser blocked reading the satellite imagery, so the image could not be saved. Open the page from a web address (for example GitHub Pages) instead of a file, then try again.'
        : `Could not create the image: ${err.message || err}`;
    }
  }

  // ---------- Persistence ----------
  function save() {
    try {
      const fields = ['coords', 'city', 'wattage', 'orientation', 'panel-length', 'panel-width', 'mounting', 'tilt',
        'azimuth-mode', 'azimuth', 'rows-per-table', 'setback', 'clearance', 'row-gap', 'pr', 'project', 'prepared-by', 'detail'];
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        fields: Object.fromEntries(fields.map((f) => [f, $(f).value])),
        roofs: state.roofs.map((r) => ({ latlngs: r.latlngs, removed: [...r.removed] })),
        obstacles: state.obstacles,
        pin: state.pin, city: state.city, sun: state.sun,
        view: { center: toLL(map.getCenter()), zoom: map.getZoom() },
      }));
    } catch { /* storage unavailable: nothing to do */ }
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { saved = null; }
    if (!saved) return;
    for (const [k, v] of Object.entries(saved.fields || {})) if ($(k) && v != null) $(k).value = v;
    state.roofs = (saved.roofs || []).map((r) => ({ latlngs: r.latlngs, removed: new Set(r.removed || []), result: null }));
    state.obstacles = saved.obstacles || [];
    state.history = [...state.roofs, ...state.obstacles];
    state.city = saved.city || '';
    state.sun = saved.sun || null;
    if (saved.pin) setPin(saved.pin);
    if (saved.view) map.setView(saved.view.center, saved.view.zoom);
  }

  // ---------- Wire up ----------
  $('city-list').innerHTML = PVEnergy.CITIES.map((c) => `<option value="${c.name}">${c.country}</option>`).join('');
  $('go-coords').addEventListener('click', goToCoords);
  $('coords').addEventListener('keydown', (e) => { if (e.key === 'Enter') goToCoords(); });
  $('go-city').addEventListener('click', goToCity);
  $('city').addEventListener('keydown', (e) => { if (e.key === 'Enter') goToCity(); });
  $('draw-roof').addEventListener('click', () => startDraw('roof'));
  $('draw-obstacle').addEventListener('click', () => {
    if (!state.roofs.length) { toast('Draw the roof first, then add obstructions on it.'); return; }
    startDraw('obstacle');
  });
  $('detect-roof').addEventListener('click', detectRoof);
  $('draw-finish').addEventListener('click', finishDraw);
  $('draw-cancel').addEventListener('click', cancelDraw);
  $('undo').addEventListener('click', () => {
    if (state.draw) { cancelDraw(); return; }
    // Skip entries already removed from the lists by hand.
    while (state.history.length) {
      const last = state.history.pop();
      const ri = state.roofs.indexOf(last), oi = state.obstacles.indexOf(last);
      if (ri >= 0) { state.roofs.splice(ri, 1); break; }
      if (oi >= 0) { state.obstacles.splice(oi, 1); clearRemovals(); break; }
    }
    runLayout();
  });
  $('clear-all').addEventListener('click', () => {
    if (!state.roofs.length && !state.obstacles.length) return;
    if (!confirm('Remove all roofs and obstructions?')) return;
    state.roofs = []; state.obstacles = []; state.history = [];
    runLayout();
  });
  $('wattage').addEventListener('change', () => {
    const m = PVEnergy.moduleSizeForWattage(parseFloat($('wattage').value) || 0);
    if (m) {
      $('panel-length').value = Math.round(m.length * 1000);
      $('panel-width').value = Math.round(m.width * 1000);
    }
    updateModuleHint();
  });
  $('mounting').addEventListener('change', () => {
    $('tilt').value = $('mounting').value === 'flush' ? 25 : 20;
  });
  ['wattage', 'orientation', 'panel-length', 'panel-width', 'mounting', 'tilt', 'azimuth-mode', 'azimuth',
    'rows-per-table', 'setback', 'clearance', 'row-gap', 'pr'].forEach((id) => {
    $(id).addEventListener('input', () => { clearRemovals(); updateMountUi(); updateModuleHint(); scheduleLayout(); });
    $(id).addEventListener('change', () => { clearRemovals(); updateMountUi(); updateModuleHint(); scheduleLayout(); });
  });
  ['project', 'prepared-by', 'detail', 'city'].forEach((id) => $(id).addEventListener('change', save));
  $('export').addEventListener('click', exportImage);
  $('modal-close').addEventListener('click', () => { $('modal').hidden = true; });
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });
  map.on('moveend', save);

  restore();
  updateMountUi();
  updateModuleHint();
  runLayout();

  // Exposed for automated tests.
  window.__pv = { state, map, parseCoords, runLayout, computeTotals };
})();
