# JZAK Cuts — licensing and third-party notices

JZAK Cuts is the property of JZac Designs. This page records exactly what is
inside the shipped `index.html`, who wrote it, and under what terms — so the app
can be sold, licensed, or bundled with a machine without a lawyer's visit.

## The short version

Everything bundled here is under a **permissive** licence. Permissive means you
may sell the software, keep your own source private, and charge whatever you
like. The only obligation any of them places on you is to carry the copyright
notice — which is what this file is for. **No copyleft (GPL/LGPL/AGPL) code is
included**, so nothing in the app can oblige you to publish your source.

## Written by JZac Designs — sole property, no outside terms

| Part | What it is |
|---|---|
| **JZAK Trace** (`libs/jzaktrace.js`) | The raster-to-vector tracing engine: crack-following outlines, sub-pixel edge snapping off the greyscale, multi-scale corner detection, and least-squares cubic Bézier fitting. Written from scratch for this product. |
| The application itself (`index.src.html`) | Canvas editor, node/point editor, transforms, align & distribute, offsetting and boolean plumbing, layout, libraries, HPGL generation, Web Serial cutter driver, PWA shell. |

An earlier version of this app traced with **potrace**, which is GPL. Using it in
a product you sell would have forced the whole app open. It has been removed
entirely and replaced with JZAK Trace, which measures more accurately than
potrace on every shape in the test bench. No potrace code remains in the build.

## Bundled third-party components

| Component | Version | Licence | What it does here |
|---|---|---|---|
| **opentype.js** | bundled build | MIT | Reads `.ttf`/`.otf` files and turns glyphs into outlines, so typed lettering becomes real cut paths. |
| **Clipper** | 6.4.2 (JS port) | Boost Software Licence 1.0 | Polygon boolean operations (weld, subtract, overlap, exclude) and offset contours. |

Both licences permit commercial use, modification, redistribution in source or
binary form, and closed-source distribution. Neither requires royalties. Their
full texts are reproduced at the bottom of this file.

## Bundled fonts

Baked into the page so lettering works on any machine, offline:

Bebas Neue · Anton · Big Shoulders Bold · Big Shoulders Stencil · Oswald Bold ·
Montserrat Bold · Archivo Black · Roboto Condensed Bold · Poppins Bold ·
Alfa Slab One · Fjalla One · Teko Bold · Bungee · Pacifico Script · Righteous

All are released under the **SIL Open Font Licence 1.1**, which allows bundling
inside and selling of a software product. The OFL's one hard rule is that the
fonts may not be sold *on their own* as fonts — embedding them in an application
is expressly permitted. If a font is ever modified and redistributed, it must be
renamed and stay under the OFL.

Fonts a user uploads themselves are stored only in that user's browser and are
never redistributed by the app.

## What you may do with JZAK Cuts

Because every piece above is permissive or your own, you may: sell licences or
one-off copies; ship it on a machine; rebrand it; host it as a paid service;
keep your source closed. The one thing to carry along is this notice file.

---

## Full licence texts

### MIT — opentype.js

Copyright (c) 2020 Frederik De Bleser

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### Boost Software Licence 1.0 — Clipper

Copyright (c) Angus Johnson 2010-2017

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by this
license (the "Software") to use, reproduce, display, distribute, execute, and
transmit the Software, and to prepare derivative works of the Software, and to
permit third-parties to whom the Software is furnished to do so, all subject to
the following:

The copyright notices in the Software and this entire statement, including the
above license grant, this restriction and the following disclaimer, must be
included in all copies of the Software, in whole or in part, and all derivative
works of the Software, unless such copies or derivative works are solely in the
form of machine-executable object code generated by a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE FOR ANY DAMAGES
OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### SIL Open Font Licence 1.1 — bundled fonts

The full text is at <https://scripts.sil.org/OFL>. In brief: the fonts may be
used, studied, modified and redistributed freely, including bundled inside and
sold with a software product; they may not be sold by themselves; modified
versions must be renamed and must stay under the same licence.
