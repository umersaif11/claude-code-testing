/*
 * PV panel placement geometry.
 *
 * Works in a local flat "east/north metres" frame around the roof, which is
 * accurate to a few centimetres at rooftop scale. Every function takes and
 * returns [lat, lng] pairs at the edges so the UI never sees the metric frame.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PVLayout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;
  const M_PER_DEG_LAT = 110574;
  const M_PER_DEG_LNG_EQ = 111320;
  const WINTER_SOLSTICE_DECLINATION = 23.45;

  function makeProjection(lat0, lng0) {
    const k = Math.cos(lat0 * DEG) * M_PER_DEG_LNG_EQ;
    return {
      toXY: ([lat, lng]) => [(lng - lng0) * k, (lat - lat0) * M_PER_DEG_LAT],
      toLatLng: ([x, y]) => [lat0 + y / M_PER_DEG_LAT, lng0 + x / k],
    };
  }

  function centroid(latlngs) {
    let lat = 0, lng = 0;
    for (const p of latlngs) { lat += p[0]; lng += p[1]; }
    return [lat / latlngs.length, lng / latlngs.length];
  }

  function polygonAreaXY(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    }
    return Math.abs(a) / 2;
  }

  /** Plan-view area of a lat/lng polygon in m². */
  function polygonArea(latlngs) {
    if (latlngs.length < 3) return 0;
    const c = centroid(latlngs);
    const proj = makeProjection(c[0], c[1]);
    return polygonAreaXY(latlngs.map(proj.toXY));
  }

  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) &&
          p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function pointSegDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  function segmentsIntersect(p1, p2, q1, q2) {
    const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2);
    const d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  function segSegDist(p1, p2, q1, q2) {
    if (segmentsIntersect(p1, p2, q1, q2)) return 0;
    return Math.min(pointSegDist(p1, q1, q2), pointSegDist(p2, q1, q2),
                    pointSegDist(q1, p1, p2), pointSegDist(q2, p1, p2));
  }

  /** Smallest gap between the outlines of two polygons (0 if they touch or cross). */
  function boundaryDistance(a, b) {
    let min = Infinity;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      for (let k = 0, l = b.length - 1; k < b.length; l = k++) {
        const d = segSegDist(a[j], a[i], b[l], b[k]);
        if (d < min) min = d;
        if (min === 0) return 0;
      }
    }
    return min;
  }

  function rotate([x, y], a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }

  function normalizeAz(a) { return ((a % 360) + 360) % 360; }

  function angleDiff(a, b) {
    const d = Math.abs(normalizeAz(a) - normalizeAz(b));
    return d > 180 ? 360 - d : d;
  }

  /**
   * Facing azimuth (degrees clockwise from north) that lines panel rows up with
   * the building: the roof's longest edge sets the building grid, and of the
   * four directions square to that grid the one closest to `preferred` wins.
   */
  function edgeAlignedAzimuth(latlngs, preferred = 180) {
    const c = centroid(latlngs);
    const proj = makeProjection(c[0], c[1]);
    const pts = latlngs.map(proj.toXY);
    let best = null, bestLen = -1;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
      const len = Math.hypot(dx, dy);
      if (len > bestLen) { bestLen = len; best = Math.atan2(dx, dy) / DEG; }
    }
    let az = preferred, diff = Infinity;
    for (let k = 0; k < 4; k++) {
      const cand = normalizeAz(best + 90 * k);
      const d = angleDiff(cand, preferred);
      if (d < diff) { diff = d; az = cand; }
    }
    return Math.round(az * 10) / 10;
  }

  /** Sun elevation at solar noon on the winter solstice, in degrees. */
  function winterNoonElevation(lat) {
    return 90 - Math.abs(lat) - WINTER_SOLSTICE_DECLINATION;
  }

  /**
   * Clear gap between the back of one table and the front of the next so the
   * front table's shadow does not reach the next one at noon on the shortest day.
   */
  function shadingRowGap(tableHeight, lat) {
    const elev = Math.max(winterNoonElevation(lat), 10);
    return tableHeight / Math.tan(elev * DEG);
  }

  /**
   * Table geometry derived from the module and mounting options. "Across" is
   * along the row, "slope" up the tilted face, "depth" the plan-view footprint.
   */
  function tableGeometry(opts) {
    const portrait = opts.orientation !== 'landscape';
    const across = portrait ? opts.panelWidth : opts.panelLength;
    const slope = portrait ? opts.panelLength : opts.panelWidth;
    const tilt = (opts.tilt || 0) * DEG;
    const flush = opts.mounting === 'flush';
    const rows = flush ? 1 : Math.max(1, Math.round(opts.rowsPerTable || 1));
    const gap = opts.panelGap ?? 0.02;
    const panelDepth = slope * Math.cos(tilt);
    const tableSlope = rows * slope + (rows - 1) * gap;
    const tableDepth = tableSlope * Math.cos(tilt);
    const tableHeight = tableSlope * Math.sin(tilt);
    let rowGap;
    if (flush) rowGap = gap;
    else if (opts.rowGap != null && opts.rowGap !== '') rowGap = Number(opts.rowGap);
    else rowGap = shadingRowGap(tableHeight, opts.latitude ?? 30);
    return { across, slope, panelDepth, rows, gap, tableDepth, tableHeight, rowGap,
             depthGap: gap * Math.cos(tilt) };
  }

  function rectFits(rect, roof, roofBox, obstacles, setback, clearance) {
    for (const p of rect) {
      if (p[0] < roofBox[0] || p[0] > roofBox[1] || p[1] < roofBox[2] || p[1] > roofBox[3]) return false;
    }
    for (const p of rect) if (!pointInPolygon(p, roof)) return false;
    if (boundaryDistance(rect, roof) < Math.max(setback, 1e-6)) return false;
    for (const ob of obstacles) {
      if (rect[0][0] > ob.box[1] + clearance || rect[2][0] < ob.box[0] - clearance ||
          rect[0][1] > ob.box[3] + clearance || rect[2][1] < ob.box[2] - clearance) continue;
      for (const p of rect) if (pointInPolygon(p, ob.pts)) return false;
      for (const p of ob.pts) if (pointInPolygon(p, rect)) return false;
      if (boundaryDistance(rect, ob.pts) < Math.max(clearance, 1e-6)) return false;
    }
    return true;
  }

  function bbox(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return [minX, maxX, minY, maxY];
  }

  function placeGrid(roof, box, obstacles, g, opts, ox, oy) {
    const colPitch = g.across + g.gap;
    const rowPitch = g.tableDepth + g.rowGap;
    const panels = [];
    // Panels face -y; the first table row sits at the low (front) side.
    let r = 0;
    for (let y0 = box[2] - rowPitch + oy; y0 < box[3]; y0 += rowPitch, r++) {
      for (let k = 0; k < g.rows; k++) {
        const py = y0 + k * (g.panelDepth + g.depthGap);
        let c = 0;
        for (let x0 = box[0] - colPitch + ox; x0 < box[1]; x0 += colPitch, c++) {
          const rect = [[x0, py], [x0 + g.across, py], [x0 + g.across, py + g.panelDepth], [x0, py + g.panelDepth]];
          if (rectFits(rect, roof, box, obstacles, opts.setback, opts.obstacleClearance)) {
            panels.push({ id: `${r}:${k}:${c}`, rect });
          }
        }
      }
    }
    return panels;
  }

  /**
   * Place panels on one roof outline.
   *
   * @param {number[][]} roofLatLngs   roof outline, [lat, lng] pairs
   * @param {number[][][]} obstacleLatLngs  outlines of tanks, stair rooms, etc.
   * @param {object} opts  panelLength/panelWidth (m), orientation, mounting
   *   ('tilted' racks on a flat roof or 'flush' on a pitched roof), tilt (deg),
   *   azimuth (deg, direction panels face), setback and obstacleClearance (m),
   *   rowsPerTable, rowGap (m, blank = auto from shading), panelGap (m),
   *   removed (Set of panel ids the user switched off).
   */
  function layoutRoof(roofLatLngs, obstacleLatLngs, opts) {
    const empty = { panels: [], count: 0, roofArea: 0, azimuth: opts.azimuth, geometry: null };
    if (!roofLatLngs || roofLatLngs.length < 3) return empty;
    const c = centroid(roofLatLngs);
    const proj = makeProjection(c[0], c[1]);
    const azimuth = opts.azimuth == null ? edgeAlignedAzimuth(roofLatLngs, c[0] >= 0 ? 180 : 0) : opts.azimuth;
    // Rotate the frame so the facing direction points along -y.
    const facingAngle = Math.atan2(Math.cos(azimuth * DEG), Math.sin(azimuth * DEG));
    const alpha = -Math.PI / 2 - facingAngle;
    const toLocal = (ll) => rotate(proj.toXY(ll), alpha);
    const toLatLng = (p) => proj.toLatLng(rotate(p, -alpha));

    const roof = roofLatLngs.map(toLocal);
    const roofArea = polygonAreaXY(roof);
    const box = bbox(roof);
    const obstacles = (obstacleLatLngs || [])
      .filter((o) => o && o.length >= 3)
      .map((o) => { const pts = o.map(toLocal); return { pts, box: bbox(pts) }; });
    const g = tableGeometry({ ...opts, latitude: opts.latitude ?? c[0] });
    if (!(g.across > 0 && g.panelDepth > 0)) return { ...empty, roofArea };

    // Slide the grid through a few offsets, plus the one that starts exactly at
    // the setback line, and keep the arrangement that fits the most panels.
    const steps = 8;
    const colPitch = g.across + g.gap, rowPitch = g.tableDepth + g.rowGap;
    const flushStart = (pitch) => ((opts.setback || 0) + 1e-3) % pitch;
    const offsets = (pitch) => [flushStart(pitch), ...Array.from({ length: steps }, (_, i) => (pitch * i) / steps)];
    let best = [];
    for (const ox of offsets(colPitch)) {
      for (const oy of offsets(rowPitch)) {
        const panels = placeGrid(roof, box, obstacles, g, opts, ox, oy);
        if (panels.length > best.length) best = panels;
      }
    }
    const removed = opts.removed || new Set();
    const panels = best.map((p) => ({
      id: p.id,
      removed: removed.has(p.id),
      corners: p.rect.map(toLatLng),
    }));
    const count = panels.filter((p) => !p.removed).length;
    return { panels, count, roofArea, azimuth, geometry: g };
  }

  return {
    makeProjection, centroid, polygonArea, pointInPolygon, boundaryDistance,
    edgeAlignedAzimuth, winterNoonElevation, shadingRowGap, tableGeometry, layoutRoof,
  };
});
