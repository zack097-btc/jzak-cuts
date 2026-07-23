# JZAK Cuts — Vinyl Cutting Studio

A house-brand, browser-based cutting app for JZac Designs — the from-scratch replacement for the tool that lived on the old laptop. It runs in **Chrome or Edge on any computer** (Windows, Mac, Linux), talks to your **USCutter over USB** using the **Web Serial API**, and sends **HPGL** cut commands (the same language VinylMaster and Silhouette use under the hood).

Because it's a single web page hosted in your own GitHub, you open it at one URL on any machine and it can never disappear with a laptop again.

---

## Run it on any computer

**Option A — Host it (recommended, this is the "any computer" part):**

1. Create a new repo in your GitHub (`zack097-btc`) named `jzak-cuts`.
2. Upload `index.html` to it.
3. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `root` → Save**.
4. After a minute it's live at: **`https://zack097-btc.github.io/jzak-cuts/`**
5. Bookmark that URL. Open it on any shop computer in Chrome/Edge — always the latest version.

GitHub Pages serves over HTTPS, which the Web Serial API requires, so the cutter connection works from the hosted URL.

**Option B — Run locally:** open `index.html` directly in Chrome/Edge. Designing and `.plt` export work anywhere; live cutting needs the HTTPS hosted URL (or `localhost`).

---

## Connecting the cutter

1. Plug the USCutter into USB and power it on (it shows up as a COM port — same as we set up for the SC631).
2. Click **Connect Cutter**, pick the port. It opens at **9600 baud, hardware flow control**.
3. Green dot = connected.

---

## Workflow

1. **Text tab** — type your lettering, pick a font (or upload your own `.ttf`/`.otf`), **Build Lettering**. **Import SVG tab** — bring in a logo/design.
2. Set **Height**, **Position** on the vinyl, rotate, and **Mirror** for HTV.
3. **Test Cut** first (cuts a 1″ square + triangle at the origin) to dial in force and confirm orientation.
4. **Send to Cutter** — or **Download .plt** to run through any spooler on the shop PC.

## Calibration & orientation

- **Steps per inch** defaults to 1016 (HPGL standard). If a 10″ cut measures long/short, scale this value proportionally and re-test.
- **Speed / Force** send as HPGL `VS`/`FS`. If your machine only honors panel settings, uncheck that box and set them on the cutter.
- **Flip X / Flip Y / Rotate** — origin conventions differ per machine. Run a Test Cut and toggle until it matches your material.

---

## What it does (v2)

Text-to-cut with custom fonts · **SVG *and* DXF import** (lines, polylines, arcs, circles) · on-material layout with size/position/rotate/mirror · **canvas zoom & pan** (mouse-wheel to zoom at the cursor, drag to pan, +/−/Fit buttons) · **blade-offset / corner-overcut compensation** (mm, so drag-knife corners cut clean) · **material presets** (Oracal 651, Oracal 751, HTV, reflective, sandblast, window tint — each sets speed/force/offset) · weed border · HPGL generation · direct-to-cutter over Web Serial · `.plt` and `.svg` export · test cut.

### Using the new v2 features

- **Zoom / pan:** mouse-wheel over the canvas zooms toward the cursor; click-drag pans; the footer shows the zoom % with `−`, `+`, and `Fit`.
- **DXF import:** the *Import SVG / DXF* tab now takes `.dxf` too — it imports at real size, then scale with Height.
- **Blade offset / overcut:** set the blade offset in mm (0.25 for a 45° blade, 0.30 for 60°) and leave "Apply corner overcut compensation" on so each closed loop cuts slightly past its start for clean corners.
- **Material presets:** pick a material at the top of the right panel to load a sensible speed/force/offset starting point — always confirm with a Test Cut.

## Ideas for v3 (just ask)

Multi-object layouts and nesting · true kerf offsetting · registration marks / print-and-cut · saved job library.

---

*Built for JZac Designs. Dependencies (opentype.js from cdnjs, default fonts from jsDelivr) load from the web; uploaded fonts and `.plt` export work fully offline.*
