/*
 * Module sizes, city data and yearly energy estimate.
 *
 * Yearly energy = kWp × GHI × 365 × transposition factor × performance ratio.
 * GHI (sunlight on flat ground, kWh/m²/day) comes from NASA POWER for the exact
 * roof when it is reachable, otherwise from the built-in city table, otherwise
 * from a latitude-only estimate. The transposition factor converts flat-ground
 * sunlight to sunlight on the tilted, oriented panel with a simple hourly
 * sun-position model over a whole year.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PVEnergy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;
  const SOLAR_CONSTANT = 1361; // W/m²
  const MODEL_CLEARNESS = 0.6;

  // Typical module sizes (metres) by power class. Users can override them.
  const MODULE_CLASSES = [
    { maxW: 330, length: 1.65, width: 0.992, label: '60-cell' },
    { maxW: 460, length: 1.722, width: 1.134, label: '108 half-cell' },
    { maxW: 500, length: 1.903, width: 1.134, label: '120 half-cell' },
    { maxW: 600, length: 2.278, width: 1.134, label: '144 half-cell (182 mm)' },
    { maxW: 630, length: 2.382, width: 1.134, label: '144 half-cell n-type' },
    { maxW: Infinity, length: 2.384, width: 1.303, label: '132 half-cell (210 mm)' },
  ];

  function moduleSizeForWattage(w) {
    return MODULE_CLASSES.find((m) => w <= m.maxW);
  }

  // Approximate long-term average GHI, kWh/m²/day, for quick offline estimates.
  const CITIES = [
    { name: 'Lahore', country: 'Pakistan', lat: 31.5204, lng: 74.3587, ghi: 5.05 },
    { name: 'Karachi', country: 'Pakistan', lat: 24.8607, lng: 67.0011, ghi: 5.45 },
    { name: 'Islamabad', country: 'Pakistan', lat: 33.6844, lng: 73.0479, ghi: 4.95 },
    { name: 'Rawalpindi', country: 'Pakistan', lat: 33.5651, lng: 73.0169, ghi: 4.95 },
    { name: 'Faisalabad', country: 'Pakistan', lat: 31.4504, lng: 73.135, ghi: 5.15 },
    { name: 'Multan', country: 'Pakistan', lat: 30.1575, lng: 71.5249, ghi: 5.3 },
    { name: 'Gujranwala', country: 'Pakistan', lat: 32.1877, lng: 74.1945, ghi: 5.0 },
    { name: 'Sialkot', country: 'Pakistan', lat: 32.4945, lng: 74.5229, ghi: 4.9 },
    { name: 'Peshawar', country: 'Pakistan', lat: 34.0151, lng: 71.5249, ghi: 5.05 },
    { name: 'Quetta', country: 'Pakistan', lat: 30.1798, lng: 66.975, ghi: 6.0 },
    { name: 'Hyderabad', country: 'Pakistan', lat: 25.396, lng: 68.3578, ghi: 5.45 },
    { name: 'Sukkur', country: 'Pakistan', lat: 27.7052, lng: 68.8574, ghi: 5.45 },
    { name: 'Bahawalpur', country: 'Pakistan', lat: 29.3956, lng: 71.6836, ghi: 5.45 },
    { name: 'Sargodha', country: 'Pakistan', lat: 32.0836, lng: 72.6711, ghi: 5.1 },
    { name: 'Gwadar', country: 'Pakistan', lat: 25.1216, lng: 62.3254, ghi: 5.75 },
    { name: 'Dubai', country: 'UAE', lat: 25.2048, lng: 55.2708, ghi: 5.9 },
    { name: 'Riyadh', country: 'Saudi Arabia', lat: 24.7136, lng: 46.6753, ghi: 6.15 },
    { name: 'Delhi', country: 'India', lat: 28.6139, lng: 77.209, ghi: 5.2 },
    { name: 'London', country: 'UK', lat: 51.5072, lng: -0.1276, ghi: 2.75 },
  ];

  function findCity(name) {
    if (!name) return null;
    const q = name.trim().toLowerCase();
    return CITIES.find((c) => c.name.toLowerCase() === q) ||
           CITIES.find((c) => q.startsWith(c.name.toLowerCase())) || null;
  }

  function nearestCity(lat, lng, maxKm = 60) {
    let best = null, bestD = Infinity;
    for (const c of CITIES) {
      const d = Math.hypot((c.lat - lat) * 111, (c.lng - lng) * 111 * Math.cos(lat * DEG));
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= maxKm ? best : null;
  }

  // Erbs correlation: fraction of global sunlight that arrives as diffuse.
  function diffuseFraction(kt) {
    if (kt <= 0.22) return 1 - 0.09 * kt;
    if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
    return 0.165;
  }

  /** Walk the sun across a year; calls fn(sunEast, sunNorth, sunUp, extraterrestrialOnFlat). */
  function forEachSunStep(lat, fn) {
    const phi = lat * DEG;
    for (let n = 1; n <= 365; n += 2) {
      const decl = 23.45 * Math.sin((360 * (284 + n)) / 365 * DEG) * DEG;
      const e0 = 1 + 0.033 * Math.cos((360 * n) / 365 * DEG);
      for (let hourAngle = -180; hourAngle < 180; hourAngle += 5) {
        const w = hourAngle * DEG;
        const up = Math.sin(decl) * Math.sin(phi) + Math.cos(decl) * Math.cos(w) * Math.cos(phi);
        if (up <= 0.03) continue;
        const east = -Math.cos(decl) * Math.sin(w);
        const north = Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.cos(w) * Math.sin(phi);
        fn(east, north, up, SOLAR_CONSTANT * e0 * up);
      }
    }
  }

  /**
   * Ratio of yearly sunlight on a panel (tilt, facing azimuth) to yearly sunlight
   * on flat ground, using an isotropic-sky model.
   */
  function transpositionFactor(lat, tilt, azimuth, albedo = 0.2) {
    const b = tilt * DEG, a = azimuth * DEG;
    const n = [Math.sin(b) * Math.sin(a), Math.sin(b) * Math.cos(a), Math.cos(b)];
    const fd = diffuseFraction(MODEL_CLEARNESS);
    let flat = 0, plane = 0;
    forEachSunStep(lat, (e, no, up, g0) => {
      const ghi = MODEL_CLEARNESS * g0;
      const dhi = ghi * fd;
      const dni = (ghi - dhi) / up;
      const cosAoi = Math.max(0, n[0] * e + n[1] * no + n[2] * up);
      flat += ghi;
      plane += dni * cosAoi + dhi * (1 + Math.cos(b)) / 2 + ghi * albedo * (1 - Math.cos(b)) / 2;
    });
    return flat ? plane / flat : 1;
  }

  /** Rough GHI (kWh/m²/day) from latitude alone, for places with no data. */
  function latitudeGhiEstimate(lat) {
    let sum = 0;
    forEachSunStep(lat, (e, n, up, g0) => { sum += g0; });
    // Each step is 5° of hour angle (1/3 h) on every second day.
    const yearly = (sum * (5 / 15) * 2) / 1000;
    return (MODEL_CLEARNESS * yearly) / 365;
  }

  /** Specific yield in kWh per kWp per year. */
  function specificYield({ ghi, lat, tilt, azimuth, pr }) {
    return ghi * 365 * transpositionFactor(lat, tilt, azimuth) * pr;
  }

  /** Long-term GHI at a point from NASA POWER; resolves null when unreachable. */
  async function fetchNasaGhi(lat, lng, timeoutMs = 9000) {
    const url = 'https://power.larc.nasa.gov/api/temporal/climatology/point' +
      `?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const json = await res.json();
      const ann = json?.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN;
      return typeof ann === 'number' && ann > 0 ? ann : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    MODULE_CLASSES, CITIES, moduleSizeForWattage, findCity, nearestCity,
    transpositionFactor, latitudeGhiEstimate, specificYield, fetchNasaGhi,
  };
});
