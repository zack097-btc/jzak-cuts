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

## What it does (v3)

Text-to-cut with custom fonts · **SVG *and* DXF import** (lines, polylines, arcs, circles) · **multi-object layout** — add as many pieces as you want, click to select, drag to move · **grid copies** — batch a whole run of the same decal across the vinyl in one cut · **canvas zoom & pan** (wheel-zoom at cursor, drag to pan, +/−/Fit) · **blade-offset / corner-overcut compensation** (mm) · **material presets** (Oracal 651/751, HTV, reflective, sandblast, window tint) · **registration marks** for print-and-cut · **saved job library** (in-browser, plus `.json` export/import) · weed border · HPGL generation · direct-to-cutter over Web Serial · `.plt` and `.svg` export · test cut.

### Using the v3 production features

- **Multiple objects:** every *Add Lettering* or import drops a new object on the mat. The **Objects on Mat** list lets you select or delete each; click an object on the canvas to select it, then **drag** to position it. The *Size & Position* panel edits whichever object is selected.
- **Batch a run (grid copies):** select an object, set **Copies** and **Gap**, hit **Make grid** — it fills the vinyl width with copies so you can cut a whole batch of the same decal at once. **Duplicate** makes a single offset copy.
- **Registration marks:** tick *Registration marks (print & cut)* to add L-shaped corner marks around the layout for aligning a cut to pre-printed material.
- **Job library:** name a job and **Save** it (stored in this browser); **Load**/**Delete** from the dropdown. Use **Export .json** to carry a job to another computer and **Import .json** to bring it back — handy for repeat orders (boat-reg pairs, USDOT kits).

## Ideas for a future rev (just ask)

True kerf offsetting · automatic nesting to minimise waste · print-and-cut auto-alignment via an optical sensor.

---

*Built for JZac Designs. Dependencies (opentype.js from cdnjs, default fonts from jsDelivr) load from the web; uploaded fonts and `.plt` export work fully offline.*
