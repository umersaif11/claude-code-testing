# Solar PV Roof Planner

Static web app for rooftop solar proposals: outline a roof on satellite imagery, panels are auto-placed, and it reports panel count, kWp and yearly kWh, then exports a 3840×2160 client image. The user is a solar PV engineer in Pakistan who shares the images with clients. See README.md for the user-facing guide.

## Hard constraints

- **No build step, no frameworks, no bundler.** Plain HTML/CSS/JS loaded with `<script>` tags in `index.html`. Keep it deployable on GitHub Pages as-is.
- **Leaflet is vendored** in `vendor/leaflet/` (1.9.4). Don't switch to a CDN and don't add runtime dependencies. If a new library is truly needed, vendor it the same way and note its license.
- **No API keys.** Every external service must be free and keyless, and the app must keep working (degraded) when it is unreachable.
- Units are metric throughout: metres and mm in the UI, m², kWp, kWh.

## Files

| File | What lives there |
|---|---|
| `index.html` | All markup; the five sidebar steps and the floating results card |
| `css/style.css` | Colour tokens on `:root`, dark mode via `prefers-color-scheme`, phone layout under `@media (max-width: 900px)` |
| `js/layout.js` | **Pure geometry** (also runs in Node). Local metre projection, point-in-polygon, setback and clearance checks, auto-facing, shading row gap, `layoutRoof()` grid search |
| `js/energy.js` | **Pure maths** (also runs in Node). Module sizes by wattage (`MODULE_CLASSES`), city table (`CITIES` with GHI kWh/m²/day), transposition model, `specificYield()`, NASA POWER fetch |
| `js/export.js` | 4K image renderer. Fetches tiles itself and draws on a canvas, then draws panels, legend and sidebar. Exposes `PVExport` |
| `js/app.js` | Leaflet map, drawing and editing, form wiring, results, localStorage, export modal. Exposes `window.__pv` for tests |
| `tests/*.test.js` | Node unit tests for layout and energy |
| `tests/e2e.mjs` | Headless-Chromium run of the real page with all network stubbed |

`layout.js` and `energy.js` use a UMD wrapper: browser globals `PVLayout` and `PVEnergy`, `module.exports` under Node. Keep them free of DOM and Leaflet so the unit tests keep working.

## Key behaviours (don't break these)

- **Coordinates:** all public functions take and return `[lat, lng]` arrays. Geometry runs in a local east/north metre frame rotated so panels face −y.
- **Facing (azimuth):** degrees clockwise from north; 180 = south. `azimuth: null` means auto. Auto aligns rows to the roof's longest edge, on the side nearest the equator.
- **Row gap (tilted mounting):** `rowGap: null` means auto, sized so there is no shading at solar noon on the winter solstice. Flush mounting ignores rows-per-table and the row gap.
- **Panel ids:** `row:depthIndex:col` are only stable while geometry and options are unchanged. Any option or geometry change clears the user's removed-panel sets (`clearRemovals()`).
- **Yield:** `kWp × GHI × 365 × transpositionFactor × PR`. The GHI source order is NASA POWER → built-in city → latitude estimate, and the source label is always shown to the user and printed on the image.
- **localStorage key** `pv-roof-planner-v1`. If the saved shape changes incompatibly, bump the key rather than breaking old saves.
- **Image export:** needs tiles served with CORS (`crossOrigin = 'anonymous'`). It must be opened over http(s), not `file://`.

## External services

Esri World Imagery tiles, OSM tiles, Nominatim (city search), Overpass (building outlines) and NASA POWER (site sunlight). The cloud sandbox usually blocks all of these, so test with the stubs in `tests/e2e.mjs`, never against live services. When the user's real-world result matters (e.g. imagery availability, CORS on a new tile source), say plainly that it could not be verified here.

## Commands

```bash
npm test                              # unit tests (no install needed)
npm install && npm run test:e2e       # browser test; writes tests/output/*.png
npm start                             # serve at http://localhost:8080
```

`tests/e2e.mjs` finds the pre-installed Chromium under `PLAYWRIGHT_BROWSERS_PATH` automatically; set `CHROME_PATH` to override. Never run `playwright install`.

## Workflow for changes

1. Put new calculation logic in `layout.js` or `energy.js` with a unit test, not in `app.js`.
2. Any new form field: add it to `readOptions()` if it affects layout, to the input/change listener list, and to the `fields` array in `save()` so it persists.
3. Anything shown in the results card that a client would care about should also appear in the export sidebar (`drawSidebar` in `export.js`). Check that it still fits the 1280 px panel.
4. Run `npm test` and `npm run test:e2e`, then **look at** `tests/output/export.png` and `desktop.png`. The tests don't catch overlapping text.
5. Update the README when a user-visible feature changes.

## Style

- Match the existing code: 2-space indent, single quotes, `const`/arrow functions, short comments only where the reason isn't obvious.
- UI text is plain English for non-technical clients. Use sentence-case labels.
- Map and image colours: roof yellow `#FFD23F`, panels navy `#14284B`, obstructions red `#E5484D`. Keep the map, legend and export consistent.
