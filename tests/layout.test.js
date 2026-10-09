const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/layout.js');

const LAT = 31.52, LNG = 74.35;
const P = L.makeProjection(LAT, LNG);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(P.toLatLng);
const MODULE = { panelLength: 2.278, panelWidth: 1.134, orientation: 'portrait', setback: 1, obstacleClearance: 0.5 };

test('roof area is measured in square metres', () => {
  assert.ok(Math.abs(L.polygonArea(rect(0, 0, 20, 15)) - 300) < 0.5);
});

test('auto facing picks the building side closest to south', () => {
  assert.equal(L.edgeAlignedAzimuth(rect(0, 0, 20, 15)), 180);
  // Building rotated 30° clockwise: rows should face 150° or 210°, never east/west.
  const rot = [[0, 0], [20, 0], [20, 15], [0, 15]].map(([x, y]) => {
    const a = -30 * Math.PI / 180;
    return P.toLatLng([x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  });
  const az = L.edgeAlignedAzimuth(rot);
  assert.ok(Math.abs(az - 150) < 0.5 || Math.abs(az - 210) < 0.5, `got ${az}`);
});

test('tilted rows on a flat roof leave the winter-noon shading gap', () => {
  const r = L.layoutRoof(rect(0, 0, 20, 15), [], { ...MODULE, mounting: 'tilted', tilt: 20, azimuth: null, rowsPerTable: 1 });
  // 18 m usable width / 1.154 m pitch = 15 panels; 13 m depth fits 4 rows at 3.25 m pitch.
  assert.equal(r.count, 60);
  assert.ok(Math.abs(r.geometry.rowGap - 1.11) < 0.02);
});

test('flush mounting packs rows tightly', () => {
  const r = L.layoutRoof(rect(0, 0, 20, 15), [], { ...MODULE, mounting: 'flush', tilt: 20, azimuth: 180 });
  assert.equal(r.count, 90);
});

test('every panel stays inside the roof setback and away from obstructions', () => {
  const roof = rect(0, 0, 20, 15);
  const tank = rect(8, 6, 11, 9);
  const r = L.layoutRoof(roof, [tank], { ...MODULE, mounting: 'flush', tilt: 0, azimuth: 180 });
  assert.ok(r.count > 0 && r.count < 90);
  for (const p of r.panels) {
    for (const [x, y] of p.corners.map(P.toXY)) {
      assert.ok(x >= 1 - 1e-6 && x <= 19 + 1e-6 && y >= 1 - 1e-6 && y <= 14 + 1e-6, 'inside setback');
      const dx = Math.max(8 - x, 0, x - 11), dy = Math.max(6 - y, 0, y - 9);
      assert.ok(Math.hypot(dx, dy) >= 0.5 - 1e-6, 'clear of tank');
    }
  }
});

test('L-shaped roofs keep panels out of the missing corner', () => {
  const lShape = [[0, 0], [20, 0], [20, 8], [10, 8], [10, 16], [0, 16]].map(P.toLatLng);
  const r = L.layoutRoof(lShape, [], { ...MODULE, setback: 0.5, mounting: 'flush', tilt: 0, azimuth: 180 });
  for (const p of r.panels) {
    for (const [x, y] of p.corners.map(P.toXY)) assert.ok(!(x > 10.01 && y > 8.01), 'panel in cut-out');
  }
  assert.ok(r.count > 40);
});

test('switched-off panels are kept but not counted', () => {
  const opts = { ...MODULE, mounting: 'flush', tilt: 0, azimuth: 180 };
  const all = L.layoutRoof(rect(0, 0, 20, 15), [], opts);
  const some = L.layoutRoof(rect(0, 0, 20, 15), [], { ...opts, removed: new Set([all.panels[0].id, all.panels[1].id]) });
  assert.equal(some.panels.length, all.panels.length);
  assert.equal(some.count, all.count - 2);
});
