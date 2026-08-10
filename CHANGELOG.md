# JZAK Cuts — what changed, version by version

## 10.6.0 — 3 August 2026

The release that came out of cutting three real jobs back to back: the Donkey
Mudd artwork, the JZAC logo traces, and the Wayback Burgers door decal. Every
item below is a thing that got in the way during one of those, measured before
it was changed and measured again after.

### The eraser

There is now an eraser in the toolbar. It is a real boolean subtraction, not a
paint-over — the stroke is swept into a shape and taken out of the artwork, so
what you get back is still a clean closed path a blade can follow. The tip has a
true width in inches, `[` and `]` resize it, and one drag is one undo rather
than a hundred tiny ones.

Erase through the waist of a shape and you get two islands inside one piece. It
stays one piece on purpose — see Break Apart below — and the app says so rather
than leaving you to find out.

### Break Apart and Combine

Layout ▸ Break Apart splits a piece into its separate islands. Layout ▸ Combine
puts several pieces back into one compound piece without melting them together.

Break Apart is nesting-aware, which is the whole point of it. A letter B comes
out as one B, not as a B and two loose blobs, because a hole travels with the
shape that contains it. A ring nested two deep — the bar of a stencil A, an
island sitting inside a counter — is genuinely a separate piece of vinyl, and
that one does come out on its own.

Nothing splits automatically. The 132-ring Wayback door block is one object
deliberately, and having it burst into ninety-eight loose objects the moment the
eraser touched a corner would destroy the layout. Illustrator, Inkscape and
Silhouette all draw the line in the same place.

### Counters no longer fill in solid

Weld, Subtract, Intersect, Exclude and Offset used to fill the counters in on
artwork written with even-odd fill — the holes in a B, the inside of an O, the
middle of a 0. The boolean engine counts winding direction; an even-odd file
winds every ring the same way and leaves nesting to say which are holes, so the
two disagreed and the holes lost.

Ring direction is now forced by nesting depth before any boolean runs. Measured
on the door decal: 10.5.2 turned two rings into one and lost an inch of area;
10.6.0 gives back two rings and the same area it started with. Script letters
that merely overlap still weld normally — the fix only looks at containment.

### Curves are 28 times finer

Committing node edits flattened every curve into 24 straight segments no matter
how big the curve was. On a 20 inch arc that is 0.147 mm of error, which is
visible on a large cut. Flattening is now adaptive to the actual curvature:
128 segments on that same arc, worst error 0.0052 mm. That is finer than the
blade, so the limit is the machine again rather than the software.

### DXF reads SPLINE and ELLIPSE

Any DXF containing a SPLINE or an ELLIPSE used to come in wrong or not at all.
Both are now read properly — the spline through a rational de Boor evaluation,
which tested exact to machine precision against the true curve.

### PDF, EPS and AI import as real vectors

You can now open a PDF, an EPS or an Illustrator file and get actual paths, not
a traced picture. Both were test-imported against the SVG of the same artwork
and came back at 132 subpaths and 14.000 x 8.3654 inches.

The SVG is still the one to reach for day to day. This is a safety net for when
a customer sends the only copy of something as a PDF.

### Saving actually saves — this one was losing work

Reported from the shop floor: designs not being there after a save. Reproduced,
measured, and it was real.

The job library was kept in browser storage, which is capped at about 5 MB. One
real job — the Wayback door decal — serialises to **1.40 MB**, because a
snapshot writes out every one of its 36,238 flattened points as text. **Three
jobs filled the box.** From the fourth on, the write threw a quota error, and
the error handler quietly put the job in memory instead. No warning. The
dropdown updated, the save looked fine, and the work was gone at the next
refresh.

What changed:

Designs now live in IndexedDB, which is bounded by free disk rather than 5 MB.
Ten copies of the door decal — 13.4 MB — save and read back with room to spare.

**A save is not reported as done until it has been read back.** If a write fails
for any reason, it says so, in a box, and tells you your design is still on
screen and how to get it onto the disk another way. Silence is never treated as
success again.

**File ▸ Save to File… (Ctrl+S) writes a real `.jzak` file to the disk.** This is
the copy that matters: back it up, email it, keep it in the customer's folder. It
survives the browser being cleared, the app being reinstalled, and the machine
being replaced. It is plain JSON on purpose, so that on the worst day of your
life it can be opened in Notepad. Coordinates are written to six decimal places
— 25 nanometres on an inch — which halves the file with no effect a blade could
find. Measured on the door decal: 1,371 KB down to 712 KB, worst point moved
0.000018 mm.

Anything already in the old library is moved across automatically the first time
10.6.0 opens, and the originals are left alone until every job has been copied
**and** read back.

### Autosave and crash recovery

The app now keeps a running copy of the mat, written five seconds after any
change and again when the window is hidden or closed. Refresh it, crash it, lose
power, close it by accident — when it reopens it says what it found, how many
pieces, and how long ago, and asks whether to put it back.

The title in the toolbar shows the job name and a dot when there are unsaved
changes, and closing with unsaved work asks first.

This is a safety net, not a filing system. It holds one document, it is cleared
the moment you save properly, and it exists so nothing is lost *between* saves —
not so saving becomes optional.

### The plotter can be switched off now

Power-cycling the cutter used to mean refreshing the software, and refreshing
threw away the design. A power cycle cost the mat. That was a software failure
wearing a hardware costume.

The connection is now allowed to drop and be rebuilt in place. Press
**⟳ Reconnect** and it goes straight back to the same port without asking you to
pick it out of a list again — Chrome and the desktop build both remember. The
design is never touched: nothing about the document depends on the port being
open.

A write that fails mid-job now says so plainly, tells you the design is safe,
and reminds you to re-load and re-origin the vinyl before resending. Layered and
panelled cuts no longer tick a layer off as done when the write never landed —
that could previously skip a colour.

### Smaller things

The second "View" menu is now called "Window", which is what it always did.

**File ▸ New Job** clears the mat, asking first if there is unsaved work.

### Licensing

No new dependency. Break Apart and Combine use the boolean engine already in the
app; PDF and EPS import uses a decompressor built into the platform; the new
storage is IndexedDB and the File System Access API, both of which are part of
the browser and the Windows web view. The bill of materials in LICENSES.md is
unchanged, and everything in it is still MIT, Boost or SIL OFL — nothing that
limits what this can be sold for.

---

## 10.5.2

DXF block definitions were being read as artwork. BLOCKS in a DXF are templates;
only an INSERT actually draws one. Reading them directly added stray rectangles
and about 0.04 in of oversize to every DXF written by a CAD program. SVG import
was never affected.

## 10.5.1

Import unit and subpath fixes.
