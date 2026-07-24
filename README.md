# JZAK Cuts — Vinyl Cutting Studio

A house-brand, browser-based cutting app for JZac Designs — the from-scratch replacement for the tool that lived on the old laptop. It runs in **Chrome or Edge on any computer** (Windows, Mac, Linux), talks to your **USCutter over USB** using the **Web Serial API**, and sends **HPGL** cut commands (the same language VinylMaster and Silhouette use under the hood).

Because it's a single web page hosted in your own GitHub, you open it at one URL on any machine and it can never disappear with a laptop again.

---

## Run it on any computer

There are three ways to run it, and they are the same program.

**Option A — Install it on Windows (best on the shop machine).** Download the
installer from the repository's [Releases](../../releases) page, run it, and JZAK
Cuts appears in the Start menu like any other program. It installs for the
current user, so it never asks for administrator rights. The installed version
owns the COM port itself instead of borrowing the browser's, which means no
browser, no internet, and no tab that can quietly drop the port halfway through
a long cut. See **[desktop/README.md](desktop/README.md)** for how that works and
how to build it yourself.

**Option B — Open it in a browser (works on any machine, no install).** Go to
**`https://zack097-btc.github.io/jzak-cuts/`** in Chrome or Edge. Cutting uses
the Web Serial API, which those two browsers have and Safari and Firefox do not.
Chrome will also offer to install it as an app from the address bar; that copy
keeps working with the shop wifi down.

**Option C — Set the hosting up from scratch** (already done, kept for reference):

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

## What it does (v10)

Text-to-cut with **your fonts built in** · **upload any file to cut or trace** · **pro image tracing** (**JZAK Trace**, our own engine — true Bézier curves, sub-pixel accurate, offline) · **point/node editor** (Silhouette-style: drag anchors & handles, corner ↔ smooth points, add/delete points) · **SVG & DXF import** as exact vectors · **free rotate to any angle** + **8-handle resize** (corners scale, sides stretch) · **multi-select** (shift-click or drag a marquee) with **group move, group scale and group rotate** · **align, distribute & arrange** (six aligns, even-gap spacing, front/back stacking) · **weld / subtract / overlap / exclude** shape algebra · **offset contour cuts** (sticker borders and inline shrinks, round · sharp · clipped corners) · **multi-object layout** (add many pieces, click to select, drag to move) · **grid copies** to batch a run · **saved designs library** + **saved job library** (in-browser, `.json` export/import) · **canvas zoom & pan** · **undo/redo (80 steps)** · **keyboard shortcuts** (nudge, copy/paste, duplicate, delete, stacking) · **installable app (PWA)** that runs offline · **blade-offset / corner-overcut compensation** · **material presets** · **registration marks** for print-and-cut · weed border · HPGL over Web Serial · `.plt`/`.svg` export · test cut.

### The tracing engine (JZAK Trace)

The tracer is ours, written from scratch for this app — no third-party tracing code, nothing that could stop the software being sold. It works in five passes: it walks the boundaries *between* pixels so every outline, hole included, comes out as an exact closed loop wound the right way; it then slides each point onto the true edge by reading the **original greyscale**, which is where the accuracy comes from — anti-aliased artwork records where the edge fell *inside* a pixel, and a black-and-white tracer throws that away; it finds real corners at several scales at once so a sharp point stays sharp while the pixel staircase is not mistaken for detail; it puts each corner back exactly where the two straight runs meeting there would cross; and finally it fits true cubic Bézier curves by least squares, splitting only where the curve genuinely misses.

Measured against shapes whose exact geometry is known — circles, rounded rectangles, pentagons, rings, thin strokes, diagonals — it lands **inside a fifth of a pixel** on clean anti-aliased art where a black-and-white tracer is stuck at half a pixel, and it holds corners to **0.20 px** against potrace's 1.04 px. On rendered lettering it sits about **30 % closer to the true outline** than potrace at a comparable node count.

It also knows when the picture cannot tell it any more. A hard-edged, un-anti-aliased image only knows its own edge to about a third of a pixel, so on those the curve is deliberately not chased tighter than that — chasing a staircase only buries the shape in nodes you then have to edit.

**Smooth slider:** 0 follows every last detail, 8 is glass-smooth. **3 is the default and is right for most artwork.** Raise it for scanned or noisy art, lower it for crisp high-resolution logos.

### For truly exact, commercial-grade cuts

Tracing turns a *picture* into cut lines — it's only ever as sharp as the image you feed it (a Silhouette `.studio3` carries just a 512 px preview inside, so it can't trace razor-sharp). For exact work, feed **real vectors**: in Silhouette Studio use **File → Save As / Export** to **SVG** (Designer Edition) or **DXF** (free edition), then import that here — it comes in as exact, infinitely scalable vector paths, no tracing. For logos you only have as images, use the **highest-resolution** source you can (original art / PDF / large PNG).

### Point / node editing (the ✎ tool)

Select a traced or imported object, pick the **✎ Edit points** tool, and you get real vector node editing: **green squares** are corner points, **blue circles** are smooth/curve points. Drag a point to move it; drag its **handles** to reshape the curve (smooth points keep their handles aligned like Silhouette); **double-click a point** to switch it between corner and smooth; **double-click a line** to add a point; press **Delete** to remove the selected point. Every edit updates the cut path live.

### Rotating & resizing on the mat

Select an object and you get the same eight-handle box the pro apps use, and it tilts with the object instead of staying stuck square to the mat.

The four **solid blue corners** scale the whole object. The four **white side handles** stretch one dimension only — grab the right handle to make lettering wider without making it taller, grab the bottom to make it taller without making it wider. Whichever handle you drag, the opposite corner or edge stays exactly where it was, so the piece grows away from where you're pulling rather than drifting across the vinyl. **Lock aspect ratio** governs the corners; holding `Shift` while you drag temporarily inverts it, so you can force a proportional drag with the lock off or a free drag with it on.

The **⟳ knob** on the stalk above the box rotates to any angle. Hold `Shift` while turning to snap to 15° steps. A blue badge shows the live angle as you turn. For an exact figure, type it into the **Angle (any °)** box in the right panel — the `0° / 90° / 180° / 270°` buttons and the box stay in sync with each other, and **Reset to 0°** squares the piece back up. All of it rotates around the object's own centre, and one `Ctrl+Z` undoes a whole drag rather than unwinding it a degree at a time.

### Selecting several pieces at once

Click a piece to select it. Hold `Shift` (or `Ctrl`) and click to add another, or click a selected one again to drop it. To grab a whole area, start a drag on empty vinyl and pull a **marquee** across the mat — everything it touches comes along, and holding `Shift` adds that catch to what you already had. `Ctrl+A` takes the whole mat. Clicking bare vinyl clears the selection, and none of the selecting costs an undo step.

Once more than one piece is selected the mat draws a dashed box around the whole group. That box works like the single-object one: drag inside it to **move** everything together, drag a **corner** to scale the group proportionally (the opposite corner stays pinned, so the spacing between pieces scales with them), or swing the **⟳ knob** on the stalk to rotate the whole arrangement — each piece orbits the group centre *and* turns on its own axis, exactly like rotating a group in Illustrator. Hold `Shift` while turning for 15° steps. Every one of those gestures is a single undo, and the selection survives the undo so you can adjust and try again.

Group scaling is deliberately proportional-only. Once the individual pieces are sitting at different angles there is no honest way to stretch a group along one axis without shearing the artwork, so the side handles stay off for groups — stretch each piece on its own instead.

### Aligning, spacing & stacking

The **Layout** panel (and the Layout menu) has three rows of buttons that do the tidying-up work by hand-eye is slow at.

**Align** — left, centre, right, top, middle, bottom. With **several pieces selected they align to each other**; with **exactly one piece selected it aligns to the mat**, which is the fastest way to centre a single decal on the vinyl. Alignment measures the box you actually see on the mat, so a piece sitting at 30° lines up by its real outer edge, not by the un-turned rectangle it started as. Nothing changes size.

**Distribute** — horizontal or vertical, needs at least three pieces. It equalises the **gaps between edges**, not the spacing between centres, so a big piece and a small piece end up with the same clearance between them rather than the same stride. The outermost two pieces never move, so the run keeps the width you set it up with. That is what you want when nesting a batch on a roll — even gaps means even weeding and no surprise overlap.

**Arrange** — bring to front, forward, backward, send to back. Stacking order is also **cut order**: the piece at the back cuts first. On layered multi-colour work that lets you set which layer the blade takes first without re-adding anything.

An align, distribute or arrange that would change nothing costs no undo step, so tapping the buttons to check is free.

### Welding, shapes & contour cuts

The **Weld, Shape & Offset** panel is the part that turns a pile of separate outlines into one clean cut path — the job Silhouette calls *Weld* and Illustrator calls the *Pathfinder*.

**Weld** melts overlapping outlines into a single piece, so the blade stops cutting the seams where they cross. It works on a whole selection, and — the case that matters most — it works on **one** object too, because script lettering comes off the Text tab as a single piece whose letters already overlap each other. Weld it once and the connected script cuts as one continuous ribbon instead of a chain of sliced-up letters.

**Subtract** punches everything above out of the piece underneath, **Overlap** keeps only the shared area, and **Exclude** keeps everything except the shared area. Subtract always works from the **stacking order** (bottom piece minus the ones above it), not from the order you happened to shift-click, which is the same rule the pro apps use — so if it comes out backwards, send a piece to the back and run it again.

**Offset** builds a new outline a set distance away from the artwork. Set the **distance**, pick how corners are handled — **Round** for the soft look most decals use, **Sharp** for a true mitered point, **Clipped** for a flattened corner — and go outward or inward.

**Outward** is the sticker/decal border: a 0.125″ contour is the standard. **Inward** eats into the shape, which is how you shrink a layer so it tucks under the one above it on multi-colour work without a hairline of the wrong colour showing at the edge.

**One outline around everything selected** is on by default. Leave it on and several pieces get a single border wrapped around the whole group — separate letters become one weeded sticker, and pieces closer together than the offset distance merge into one outline. Turn it off and each piece gets its own border.

The contour comes in as its own new piece dropped in **behind** the artwork, so it cuts first, it can carry its own colour, and it never gets in the way of clicking the original. Holes stay holes through an offset, so a ring or a letter *O* keeps its middle.

Anything that would leave nothing behind — an inward offset wider than the shape, an overlap of two pieces that don't touch — says so and changes nothing, and costs no undo step. Everything else is a single `Ctrl+Z`.

The maths runs in integer space at 0.00001″ resolution, and round corners are held within 0.0005″ of a true arc, so the result is exact enough that nothing about it is the limiting factor next to the blade.

### Undo / redo & keyboard shortcuts

Every edit is undoable — moving, scaling, rotating, mirroring, colour changes, add/delete/duplicate, grid copies, re-traces, job loads, and point edits. Use the **↶ / ↷** buttons at the bottom of the toolbox or the keyboard.

| Shortcut | Does |
|---|---|
| `Ctrl+Z` | Undo (works in every tool, including the point editor) |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / paste — the whole selection, not just one piece |
| `Ctrl+D` | Duplicate the selection |
| `Ctrl+A` | Select everything on the mat |
| `Delete` | Delete the selection (or the selected point, in ✎ mode) |
| Arrow keys | Nudge the selection 0.05″ · hold `Shift` for 0.5″ |
| `Ctrl+]` / `Ctrl+[` | Bring forward / send backward one step |
| `Ctrl+Shift+]` / `Ctrl+Shift+[` | Bring to front / send to back |

History holds the last 80 steps. A run of small changes — dragging a handle, holding an arrow key, typing in the width box — collapses into a single undo step, so one `Ctrl+Z` puts you back where you started rather than unwinding one pixel at a time.

### Using the v4 features

- **Your fonts:** Bebas Neue, Anton, Big Shoulders (Bold) and Big Shoulders Stencil are baked in and available on any computer. Need another? **Upload a .ttf/.otf** in the Text tab — it's saved in that browser and shows up in the font list next time.
- **Upload anything to cut or trace:** the *Import / Trace* tab takes SVG and DXF as vectors, **any image** (PNG/JPG/GIF/BMP/WEBP), and Silhouette **.studio3** files — all auto-traced into cut lines. Adjust the **threshold** slider (and **Invert** for light-on-dark art) and hit **Re-trace** until the outline is clean. (.studio3 is a closed format, so it traces the file's embedded preview image; for PDF/AI, export to SVG or PNG first.)
- **Saved designs:** select an object and **Save** it to your library (left panel) — traced logos, imported art, lettering — then **Add to mat** any time to reuse it.
- **Multiple objects & batch runs:** every add drops a new object; click to select, drag to move. Select one, set **Copies**/**Gap**, and **Make grid** to fill the vinyl with a whole batch in one cut.
- **Registration marks & job library:** tick *Registration marks* for print-and-cut alignment; save/load whole jobs (mat + settings), and export a `.json` to move a job between computers.

## Building from source

`index.html` is generated, not hand-edited. **Always edit `index.src.html`** —
anything typed into `index.html` is thrown away by the next build.

```
python build.py
```

That reads `index.src.html`, the three libraries in `libs/`, and the font payload
in `fonts.json`, and writes the single self-contained `index.html` the website
and the installer both serve. Everything it needs is in this repository, so a
fresh clone rebuilds the identical file — nothing is fetched and nothing lives
outside the repo.

| file | what it is |
|---|---|
| `index.src.html` | the studio — the file you edit |
| `libs/jzaktrace.js` | our tracing engine (MIT, ours) |
| `libs/opentype.min.js` | font parsing (MIT) |
| `libs/clipper.js` | polygon boolean operations, used by weld and contour (Boost) |
| `fonts.json` | the bundled fonts, base64'd (SIL OFL) |
| `build.py` | stitches all of the above into `index.html` |
| `desktop/` | the native Windows shell — see its own README |

The `*.cjs` files at the top level are the test suite; run any of them with
`node <file>.cjs` against a headless Chromium. They cover tracing accuracy,
node editing, rotation, alignment, welding, undo/redo, the PWA, the font
loader, and both halves of the serial layer.

## Licensing

Every piece of code in the shipped page is either ours or under a permissive
licence (MIT, Boost, SIL OFL). There is **no GPL code in the build**, so the app
can be sold, licensed, rebranded or bundled with a machine without any
obligation to publish source. See **[LICENSES.md](LICENSES.md)** for the full
notice — keep that file with the app.

## Ideas for a future rev (just ask)

Automatic nesting to minimise waste · print-and-cut auto-alignment via an optical sensor · centerline tracing for single-line engraving fonts.

---

*Built for JZac Designs. The tracing engine (JZAK Trace, ours) and the font engine (opentype.js) are bundled into the page, so tracing, point-editing, and cutting all work fully offline. Only the optional Google-font downloads need the web; your built-in fonts, uploaded fonts, and `.plt` export work offline.*
