const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/energy.js');

test('module size follows the wattage class', () => {
  assert.equal(E.moduleSizeForWattage(580).length, 2.278);
  assert.equal(E.moduleSizeForWattage(700).width, 1.303);
});

test('south tilt gains, north tilt loses, flat is neutral', () => {
  assert.equal(E.transpositionFactor(31.5, 0, 180).toFixed(3), '1.000');
  assert.ok(E.transpositionFactor(31.5, 20, 180) > 1.04);
  assert.ok(E.transpositionFactor(31.5, 20, 0) < 0.9);
  // Southern hemisphere mirrors it.
  assert.ok(E.transpositionFactor(-33.9, 25, 0) > 1.04);
});

test('Lahore specific yield lands in the usual 1,400–1,650 kWh/kWp band', () => {
  const c = E.findCity('lahore');
  const sy = E.specificYield({ ghi: c.ghi, lat: c.lat, tilt: 20, azimuth: 180, pr: 0.77 });
  assert.ok(sy > 1400 && sy < 1650, `got ${sy}`);
});

test('city lookup and nearest city', () => {
  assert.equal(E.findCity(' Karachi ').name, 'Karachi');
  assert.equal(E.nearestCity(31.47, 74.27).name, 'Lahore');
  assert.equal(E.nearestCity(0, 0), null);
});
