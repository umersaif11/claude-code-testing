# Solar PV Roof Planner

A web page for quick rooftop solar proposals. Find the building, outline the roof on satellite imagery, and the panels are placed automatically. You see the panel count, system size (kWp) and estimated yearly generation (kWh), and can export a 4K (3840 × 2160) image to share with clients.

No sign-up, no API keys and no build step. It is plain HTML and JavaScript.

## Use it

**Online (recommended):** turn on GitHub Pages for this repo (Settings → Pages → *Deploy from a branch* → `main`, folder `/`). The planner is then served at `https://<your-user>.github.io/claude-code-testing/`.

**On your own computer:** download the repo and run a small local web server in its folder:

```bash
python3 -m http.server 8080      # or: npm start
```

Then open <http://localhost:8080>. Opening `index.html` by double-clicking works for planning, but some browsers block the image export from `file://` pages.

## Steps

1. **Location:** paste the roof coordinates (`31.5204, 74.3587`, `31°31'13"N 74°21'31"E` or a Google Maps link) and press **Go**. Type the city as well; it is used for the sunlight estimate.
2. **Roof:** click **Draw roof** and click each corner of the roof, then click the first point (or press Enter) to close it. Drag the yellow dots to fine-tune. **Detect outline** pulls the building outline from OpenStreetMap where one exists. Use **Add obstruction** for water tanks, stair rooms, AC units and similar. You can draw several roofs.
3. **Panels:** enter the panel wattage. Length and width are filled in from typical modules of that class; correct them from the datasheet.
4. **Mounting:**
   - *Flat roof, tilted structures* spaces the rows so one row does not shade the next at noon on 21 December. You can type your own row gap instead.
   - *Sloped roof, flush mounted* packs panels tightly along the roof slope.
   - *Panels face → Auto* lines rows up with the building, on the side closest to south.
5. **Fine-tune:** click any panel on the map to remove it (for example over a skylight). Click it again to bring it back.
6. **Client image:** add the project/client name and, if you want, your company name. Then click **Export HD image** → **Download PNG**.

Your work is saved in the browser, so a refresh does not lose it.

## How the numbers are worked out

| Output | Method |
|---|---|
| Panels | Grid search over row/column offsets for the arrangement that fits the most panels. Each panel must stay inside the roof, keep the edge setback and keep the clearance from every obstruction. |
| System size | panels × wattage |
| Yearly kWh | kWp × sunlight (kWh/m²/day) × 365 × tilt/orientation factor × performance ratio |
| Sunlight | NASA POWER long-term average for the exact site when reachable. Otherwise a built-in city average (major Pakistani cities and a few others), otherwise a rough estimate from latitude. The source is shown under the results and on the image. |
| Tilt factor | Hourly sun-position model over a full year with an isotropic sky, so south-facing tilt gains, north-facing loses |

The default performance ratio of 0.77 covers heat, dust, inverter and cable losses typical for Pakistan. Adjust it to your own practice.

> These are planning estimates. Check shading, structure and the final yield in your design software (PVsyst, PVGIS, etc.) before committing to a quote.

## Online services used

| Service | Purpose |
|---|---|
| Esri World Imagery | Satellite map and export background (attribution is printed on the image) |
| OpenStreetMap: Nominatim, Overpass | City search and building outlines |
| NASA POWER | Site sunlight data |

If a service is unreachable, the planner falls back to drawing by hand and the built-in city data.

## Project layout

```
index.html        page
css/style.css     styles (light and dark)
js/layout.js      panel placement geometry (no browser needed)
js/energy.js      module sizes, city data, yield model
js/export.js      4K client image renderer
js/app.js         map, drawing and UI
vendor/leaflet/   Leaflet 1.9.4 map library (BSD-2-Clause)
tests/            unit tests (npm test) and browser test (npm run test:e2e)
CLAUDE.md         notes for Claude Code when changing this project
```
