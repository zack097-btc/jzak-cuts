/* =============================================================================
   JZAK Trace — raster to vector tracing engine
   Written from scratch for JZac Designs / JZAK Cuts. No third-party code.
   (c) JZac Designs. All rights reserved.

   How it works, in order:

     1. Threshold the picture into a shape/not-shape mask.
     2. Walk the "cracks" between shape and background pixels to get every
        outline as an exact staircase loop, holes included, each one wound the
        opposite way to the outline that contains it.
     3. Snap that staircase onto the real edge using the ORIGINAL greyscale.
        A cutting file wants the edge where the eye sees it, not where the
        pixel grid happens to fall, and on anti-aliased art the true edge sits
        between pixels. This step is why this tracer can land inside a fifth of
        a pixel where a pure black-and-white tracer is stuck at half a pixel.
     4. Find the real corners at several scales at once, so a sharp corner is
        kept and the staircase's own jaggies are not mistaken for corners.
     5. Fit true cubic Bezier curves to the runs between corners by least
        squares, re-parameterising and splitting until the curve sits inside
        the error tolerance. Same class of fit the pro packages use.

   Output is an SVG path string (M / L / C / Z) in pixel coordinates.
   ========================================================================== */
var JZTrace = (function () {
  "use strict";

  /* ---------------------------------------------------------------- mask -- */

  /* 1 where the shape is. Anything off the edge of the picture counts as
     background, so shapes that run off the side still close cleanly. */
  function buildMask(img, thr, invert) {
    var w = img.width, h = img.height, d = img.data,
        m = new Uint8Array(w * h), i, p;
    for (i = 0, p = 0; i < m.length; i++, p += 4) {
      var lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2],
          a = d[p + 3] / 255;
      /* transparent pixels read as background, whatever colour they claim */
      lum = lum * a + 255 * (1 - a);
      var on = lum < thr;
      if (invert) on = !on;
      m[i] = on ? 1 : 0;
    }
    return { w: w, h: h, m: m };
  }

  /* greyscale copy of the ORIGINAL picture, alpha flattened onto white,
     already flipped so that "more = more shape" — that makes the sub-pixel
     hunt below a plain rising-edge search no matter how the user set Invert. */
  function buildGray(img, invert) {
    var w = img.width, h = img.height, d = img.data,
        g = new Float32Array(w * h), md = new Uint8Array(w * h), i, p, mid = 0;
    for (i = 0, p = 0; i < g.length; i++, p += 4) {
      var lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2],
          a = d[p + 3] / 255;
      lum = lum * a + 255 * (1 - a);
      var v = invert ? lum : 255 - lum;
      g[i] = v;
      /* half-tone pixels only happen along a soft edge, so marking them tells
         us, edge by edge, whether this piece of artwork actually records where
         the edge fell inside the pixel — or is hard black and white with
         nothing in between and half a pixel of doubt nobody can remove */
      if (v > 30 && v < 225) { md[i] = 1; mid++; }
    }
    return { g: g, mid: mid, md: md };
  }

  /* ------------------------------------------------------------- outlines -- */

  /* Every outline is a loop of unit steps along the boundaries between pixels.
     We walk with the shape always on our right, which makes outer outlines and
     the holes inside them come out wound opposite ways all on their own —
     exactly what the cut engine needs to know a hole is a hole. */
  function contours(mask, turd) {
    var w = mask.w, h = mask.h, m = mask.m,
        P = function (x, y) {
          return (x < 0 || y < 0 || x >= w || y >= h) ? 0 : m[y * w + x];
        },
        /* one flag per crack, so no outline is ever walked twice */
        hv = new Uint8Array(w * (h + 1)),          /* horizontal cracks */
        vv = new Uint8Array((w + 1) * h),          /* vertical cracks   */
        loops = [], x, y;

    /* direction: 0 right, 1 down, 2 left, 3 up */
    var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

    function stepDir(vx, vy, from) {
      var a = P(vx - 1, vy - 1), b = P(vx, vy - 1),
          c = P(vx - 1, vy), d = P(vx, vy),
          up    = (b === 1 && a === 0),
          down  = (c === 1 && d === 0),
          right = (d === 1 && b === 0),
          left  = (a === 1 && c === 0),
          n = (up ? 1 : 0) + (down ? 1 : 0) + (right ? 1 : 0) + (left ? 1 : 0);
      if (n === 0) return -1;
      if (n === 1) return up ? 3 : down ? 1 : right ? 0 : 2;
      /* Two ways out means the shape touches itself corner to corner. Always
         taking the left turn treats those two pixels as joined, which is what
         a person means by one shape, and it keeps the loop from crossing
         itself. */
      var lt = (from + 3) & 3;
      if (lt === 3 && up) return 3;
      if (lt === 1 && down) return 1;
      if (lt === 0 && right) return 0;
      if (lt === 2 && left) return 2;
      return up ? 3 : down ? 1 : right ? 0 : 2;
    }

    function seen(vx, vy, dir) {
      if (dir === 0) return hv[vy * w + vx];
      if (dir === 2) return hv[vy * w + (vx - 1)];
      if (dir === 1) return vv[vy * (w + 1) + vx];
      return vv[(vy - 1) * (w + 1) + vx];
    }
    function mark(vx, vy, dir) {
      if (dir === 0) hv[vy * w + vx] = 1;
      else if (dir === 2) hv[vy * w + (vx - 1)] = 1;
      else if (dir === 1) vv[vy * (w + 1) + vx] = 1;
      else vv[(vy - 1) * (w + 1) + vx] = 1;
    }

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        /* a shape pixel with background directly above starts an outline
           heading right — every loop has a topmost run, so nothing is missed */
        if (!(P(x, y) === 1 && P(x, y - 1) === 0)) continue;
        if (hv[y * w + x]) continue;
        var pts = [], vx = x, vy = y, dir = 0, guard = 0, lim = 8 * (w + 2) * (h + 2);
        do {
          pts.push([vx, vy]);
          mark(vx, vy, dir);
          vx += DX[dir]; vy += DY[dir];
          var nd = stepDir(vx, vy, dir);
          if (nd < 0) break;
          if (seen(vx, vy, nd)) { dir = nd; break; }
          dir = nd;
        } while (++guard < lim && !(vx === x && vy === y));
        if (pts.length < 4) continue;
        var A = signedArea(pts);
        if (Math.abs(A) < turd) continue;
        /* pts is every lattice step, so it is already a polyline with its
           points exactly one pixel apart — that even spacing is what the
           smoothing and the edge hunt below both rely on */
        loops.push({ pts: pts, area: A });
      }
    }
    return loops;
  }

  function signedArea(p) {
    var s = 0, n = p.length, i, a, b;
    for (i = 0; i < n; i++) { a = p[i]; b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2;
  }

  function dropCollinear(p) {
    var out = [], n = p.length, i;
    for (i = 0; i < n; i++) {
      var a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n],
          cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cr !== 0) out.push(b);
    }
    return out.length >= 3 ? out : p;
  }

  /* ------------------------------------------------------- sub-pixel snap -- */

  /* bilinear read of the greyscale, clamped at the border */
  function G(g, w, h, x, y) {
    if (x < 0) x = 0; if (y < 0) y = 0;
    if (x > w - 1) x = w - 1; if (y > h - 1) y = h - 1;
    var x0 = Math.floor(x), y0 = Math.floor(y),
        x1 = x0 + 1 > w - 1 ? w - 1 : x0 + 1,
        y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1,
        fx = x - x0, fy = y - y0,
        a = g[y0 * w + x0], b = g[y0 * w + x1],
        c = g[y1 * w + x0], d = g[y1 * w + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  /* Take the staircase off the outline. The points come in one pixel apart, so
     a small bell-shaped average along the loop cancels the half-pixel zig-zag
     of the pixel grid while pulling a real edge nowhere it should not go. On a
     100px circle this costs about five thousandths of a pixel of radius. */
  /* Where the picture is hard black and white the zig-zag is a full pixel tall
     instead of a soft ramp, so those stretches are averaged over a wider span —
     which is exactly where the extra averaging is safe, because there is no
     sub-pixel detail there to blur away. */
  function smoothLoop(pts, sigma, soft, boost) {
    var n = pts.length;
    if (n < 12) return pts.map(function (p) { return [p[0], p[1]]; });
    var vary = !!(soft && boost), out = [], i, k;
    var rad0 = Math.max(1, Math.round(sigma * 3)), wgt0 = [], s0 = 0;
    for (k = -rad0; k <= rad0; k++) { var q = Math.exp(-(k * k) / (2 * sigma * sigma)); wgt0.push(q); s0 += q; }
    for (i = 0; i < n; i++) {
      var sg = vary ? sigma * (1 + boost * (1 - soft[i])) : sigma,
          rad = vary ? Math.max(1, Math.round(sg * 3)) : rad0,
          ax = 0, ay = 0, s = vary ? 0 : s0;
      for (k = -rad; k <= rad; k++) {
        var p = pts[(i + k + n * 4) % n],
            ww = vary ? Math.exp(-(k * k) / (2 * sg * sg)) : wgt0[k + rad0];
        ax += p[0] * ww; ay += p[1] * ww;
        if (vary) s += ww;
      }
      out.push([ax / s, ay / s]);
    }
    return out;
  }

  /* Tangent of the loop at i, measured across a few points each way so no one
     point can tilt it. Returns a unit vector in the direction of travel. */
  function loopTangent(pts, i, n, span) {
    var a = pts[(i - span + n * 4) % n], b = pts[(i + span) % n],
        t = norm(sub(b, a));
    if (t[0] === 0 && t[1] === 0) t = norm(sub(pts[(i + 1) % n], pts[i]));
    return t;
  }

  /* --------------------------------------------------------- edge finding --
     Where is the edge REALLY, to a fraction of a pixel?

     Look straight across the edge and add up how much shape there is over a
     short run. A straight edge sitting a distance e outside the point we are
     testing puts exactly (e + R) pixels' worth of shape in a window reaching R
     each way — so the total tells us e directly. It is an average over the
     whole window rather than a single reading, which is why it survives both
     anti-aliased art (where the grey ramp IS the edge position) and hard-edged
     art (where the staircase's own density carries the answer). We repeat it a
     little way along the edge in both directions and average, which is what
     recovers sub-pixel accuracy from artwork that has no grey pixels at all.

     Everything is measured in picture coordinates, where a crack at lattice
     (x,y) sits half a pixel up and left of the centre of pixel (x,y). */

  var EDGE_STEP = 0.15,             /* how finely we read across the edge  */
      EDGE_TANG = [-1.2, -0.6, 0, 0.6, 1.2],   /* readings along the edge  */
      EDGE_REACH = [1.5, 1.0, 0.7];            /* window sizes to try      */

  function edgeOffsetOnce(g, w, h, px, py, nx, ny, R) {
    var sx = px - 0.5, sy = py - 0.5,
        hi = G(g, w, h, sx - nx * R, sy - ny * R),   /* deep inside the shape */
        lo = G(g, w, h, sx + nx * R, sy + ny * R);   /* out in the background */
    if (hi - lo < 40) return null;                   /* no clean edge here    */
    var span = hi - lo, sum = 0, t, first = true, prev = 0;
    for (t = -R; t <= R + 1e-9; t += EDGE_STEP) {
      var c = (G(g, w, h, sx + nx * t, sy + ny * t) - lo) / span;
      if (c < 0) c = 0; if (c > 1) c = 1;
      if (!first) sum += (c + prev) * 0.5 * EDGE_STEP;   /* trapezium */
      prev = c; first = false;
    }
    var e = sum - R, cap = R * 0.8;
    if (e > cap) e = cap; if (e < -cap) e = -cap;
    return e;
  }

  function edgeOffset(g, w, h, px, py, nx, ny) {
    var tx = -ny, ty = nx, k, r, tot = 0, cnt = 0;
    for (k = 0; k < EDGE_TANG.length; k++) {
      var s = EDGE_TANG[k], qx = px + tx * s, qy = py + ty * s, e = null;
      for (r = 0; r < EDGE_REACH.length && e === null; r++) {
        e = edgeOffsetOnce(g, w, h, qx, qy, nx, ny, EDGE_REACH[r]);
      }
      if (e !== null) { tot += e; cnt++; }
    }
    return cnt ? tot / cnt : 0;
  }

  /* Move every point of a smoothed loop onto the real edge. The walk keeps the
     shape on its right, so the outward normal is the direction of travel
     turned the other way. */
  function snapLoop(pts, g, w, h) {
    var n = pts.length, out = [], i;
    for (i = 0; i < n; i++) {
      var t = loopTangent(pts, i, n, 2), nx = t[1], ny = -t[0],
          p = pts[i], e = edgeOffset(g, w, h, p[0], p[1], nx, ny);
      out.push([p[0] + nx * e, p[1] + ny * e]);
    }
    return out;
  }

  /* How much sub-pixel information does the picture actually carry HERE?
     Straight machine-drawn sides can be hard-edged while the curves beside
     them are soft, so this is answered point by point rather than once for the
     whole picture, and then averaged over a short stretch so the answer does
     not flicker. 1 = a soft edge we can read to a fraction of a pixel,
     0 = hard black and white where half a pixel is anyone's guess. */
  function softness(raw, md, w, h) {
    var n = raw.length, s = new Float64Array(n), i, dx, dy;
    for (i = 0; i < n; i++) {
      var x = raw[i][0], y = raw[i][1], hit = 0;
      for (dy = -2; dy <= 1 && !hit; dy++) {
        for (dx = -2; dx <= 1; dx++) {
          var px = x + dx, py = y + dy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          if (md[py * w + px]) { hit = 1; break; }
        }
      }
      s[i] = hit;
    }
    var out = new Float64Array(n), R = 4, k;
    for (i = 0; i < n; i++) {
      var sum = 0;
      for (k = -R; k <= R; k++) sum += s[(i + k + n * 8) % n];
      out[i] = sum / (2 * R + 1);
    }
    return out;
  }

  /* How hard is the outline bending here? On a hard black-and-white edge any
     single point is a coin-flip within half a pixel, but along a straight run
     that doubt averages out to nothing — a hundred noisy points still make one
     very accurate line. It is only where the outline bends that there are too
     few points in a row to average, so that is the only place the fit deserves
     any extra slack. Measured as the sag away from the chord, then smoothed so
     the answer does not flicker point to point. */
  function bendAmount(pts) {
    var n = pts.length, s = new Float64Array(n), i, S = 4, R = 5, k;
    if (n < 3 * S) { for (i = 0; i < n; i++) s[i] = 1; return s; }
    for (i = 0; i < n; i++) s[i] = offLine(pts[(i - S + n * 4) % n], pts[(i + S) % n], pts[i]);
    var out = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var sum = 0;
      for (k = -R; k <= R; k++) sum += s[(i + k + n * 8) % n];
      out[i] = sum / (2 * R + 1);
    }
    return out;
  }

  /* ------------------------------------------------------------- geometry -- */

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
  function norm(a) { var l = len(a); return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l]; }
  function dist(a, b) { return len(sub(a, b)); }

  /* ------------------------------------------------------------- corners -- */

  /* how far the outline swings round between the point s back and s forward */
  function turnAt(pts, i, n, s) {
    var u = norm(sub(pts[i], pts[(i - s + n * 4) % n])),
        v = norm(sub(pts[(i + s) % n], pts[i]));
    if ((u[0] === 0 && u[1] === 0) || (v[0] === 0 && v[1] === 0)) return 0;
    var c = dot(u, v);
    if (c > 1) c = 1; if (c < -1) c = -1;
    return Math.acos(c);
  }

  /* Telling a real corner from a tight curve, the way a person does it: stand
     twice as far back. A curve keeps bending, so the swing doubles with you. A
     corner has already done all its bending, so the swing barely grows. That
     test does not care how big the artwork is, so a tiny circle stays a circle
     and a sharp point stays a point. */
  function findCorners(pts, angLimit) {
    var n = pts.length, i, k, sharp = new Float64Array(n), mark = new Uint8Array(n);
    if (n < 10) { for (i = 0; i < n; i++) mark[i] = 1; return mark; }
    for (i = 0; i < n; i++) {
      var near = turnAt(pts, i, n, 2), far = turnAt(pts, i, n, 4);
      /* corner: already swinging hard up close, and standing back adds little */
      sharp[i] = (near >= angLimit * 0.55 && far <= near * 1.9) ? near : 0;
    }
    /* keep only the sharpest point in each little run of candidates, so one
       corner does not become three nodes stacked on top of each other */
    for (i = 0; i < n; i++) {
      if (sharp[i] <= 0) continue;
      var best = true;
      for (k = -3; k <= 3; k++) {
        if (!k) continue;
        var j = (i + k + n * 8) % n;
        if (sharp[j] > sharp[i] || (sharp[j] === sharp[i] && j < i)) { best = false; break; }
      }
      if (best) mark[i] = 1;
    }
    return mark;
  }

  /* Smoothing rounds a sharp point off, and the edge hunt cannot see round a
     corner either. So put the point back exactly where it belongs: run a
     straight line through the clean stretch on each side and cross them.
     The stretch it reads must stay on ONE side of the corner — on a thin
     stroke the next corner is only a few points away, and a line fitted
     across it bends, which throws the crossing point clean off the shape.
     So back and gap say how far the clean run really reaches each way. */
  function sharpenCorner(pts, c, n, back, gap) {
    var e1 = Math.min(9, back - 1), e2 = Math.min(9, gap - 1);
    if (e1 < 5 || e2 < 5) return null;             /* no room for a clean line */
    var L1 = fitLine(pts, c - e1, c - 3, n), L2 = fitLine(pts, c + 3, c + e2, n);
    if (!L1 || !L2) return null;
    var den = L1.dx * L2.dy - L1.dy * L2.dx;
    if (Math.abs(den) < 0.12) return null;         /* nearly parallel — leave it */
    var ex = L2.x - L1.x, ey = L2.y - L1.y,
        t = (ex * L2.dy - ey * L2.dx) / den,
        px = L1.x + L1.dx * t, py = L1.y + L1.dy * t;
    /* a short run cannot justify a long reach: cap the move by the room we had */
    var cap = Math.min(2.5, 0.3 * Math.min(e1, e2));
    if (dist([px, py], pts[c]) > cap) return null; /* nonsense — leave it */
    return [px, py];
  }

  /* least-squares line through a stretch of the loop, as point + direction */
  function fitLine(pts, a, b, n) {
    var cnt = b - a + 1, i, sx = 0, sy = 0;
    if (cnt < 3) return null;
    for (i = a; i <= b; i++) { var p = pts[(i + n * 8) % n]; sx += p[0]; sy += p[1]; }
    var mx = sx / cnt, my = sy / cnt, sxx = 0, sxy = 0, syy = 0;
    for (i = a; i <= b; i++) {
      var q = pts[(i + n * 8) % n], dx = q[0] - mx, dy = q[1] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    /* direction of least spread away from the line = biggest eigenvector */
    var th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { x: mx, y: my, dx: Math.cos(th), dy: Math.sin(th) };
  }

  /* ----------------------------------------------------------- curve fit -- */

  function bezAt(b, t) {
    var mt = 1 - t, a0 = mt * mt * mt, a1 = 3 * mt * mt * t, a2 = 3 * mt * t * t, a3 = t * t * t;
    return [b[0][0] * a0 + b[1][0] * a1 + b[2][0] * a2 + b[3][0] * a3,
            b[0][1] * a0 + b[1][1] * a1 + b[2][1] * a2 + b[3][1] * a3];
  }
  function bezD(b, t) {
    var mt = 1 - t,
        c0 = 3 * mt * mt, c1 = 6 * mt * t, c2 = 3 * t * t;
    return [c0 * (b[1][0] - b[0][0]) + c1 * (b[2][0] - b[1][0]) + c2 * (b[3][0] - b[2][0]),
            c0 * (b[1][1] - b[0][1]) + c1 * (b[2][1] - b[1][1]) + c2 * (b[3][1] - b[2][1])];
  }
  function bezDD(b, t) {
    var mt = 1 - t;
    return [6 * mt * (b[2][0] - 2 * b[1][0] + b[0][0]) + 6 * t * (b[3][0] - 2 * b[2][0] + b[1][0]),
            6 * mt * (b[2][1] - 2 * b[1][1] + b[0][1]) + 6 * t * (b[3][1] - 2 * b[2][1] + b[1][1])];
  }

  function chordParam(pts) {
    var u = [0], i;
    for (i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
    var last = u[u.length - 1] || 1;
    for (i = 0; i < u.length; i++) u[i] /= last;
    return u;
  }

  /* least squares: the ends and the two tangent directions are fixed, so all
     that is left to solve for is how far each handle reaches out */
  function fitOne(pts, u, t1, t2) {
    var n = pts.length, C = [[0, 0], [0, 0]], X = [0, 0], i;
    for (i = 0; i < n; i++) {
      var t = u[i], mt = 1 - t,
          b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t,
          A1 = mul(t1, b1), A2 = mul(t2, b2);
      C[0][0] += dot(A1, A1); C[0][1] += dot(A1, A2);
      C[1][0] += dot(A1, A2); C[1][1] += dot(A2, A2);
      var tmp = sub(pts[i], add(add(mul(pts[0], b0), mul(pts[0], b1)),
                                add(mul(pts[n - 1], b2), mul(pts[n - 1], b3))));
      X[0] += dot(A1, tmp); X[1] += dot(A2, tmp);
    }
    var det = C[0][0] * C[1][1] - C[1][0] * C[0][1],
        a1, a2, segLen = dist(pts[0], pts[n - 1]);
    if (Math.abs(det) > 1e-12) {
      a1 = (X[0] * C[1][1] - X[1] * C[0][1]) / det;
      a2 = (C[0][0] * X[1] - C[1][0] * X[0]) / det;
    } else { a1 = a2 = 0; }
    var eps = 1e-6 * segLen;
    if (a1 < eps || a2 < eps) { a1 = a2 = segLen / 3; }
    /* a handle longer than the segment itself means the fit has run away */
    var cap = segLen * 3;
    if (a1 > cap) a1 = cap;
    if (a2 > cap) a2 = cap;
    return [pts[0], add(pts[0], mul(t1, a1)), add(pts[n - 1], mul(t2, a2)), pts[n - 1]];
  }

  /* How far outside its allowance does the curve stray, and where worst?
     The allowance is per point because one stretch of an outline can carry
     more information than the next. Zero or less means the fit is good. */
  function maxError(pts, u, bez, tols) {
    var n = pts.length, ex = new Float64Array(n), i, k;
    for (i = 0; i < n; i++) ex[i] = dist(bezAt(bez, u[i]), pts[i]) - tols[i];
    /* One point out of place is the pixel grid talking, not the curve being
       wrong — and answering it with another node would only carve the noise
       into the vinyl. A curve that is really cutting a corner is outside its
       allowance for a whole stretch, so the run of points is what gets judged.
       A single wild point is still taken at face value, because that is a real
       feature being missed rather than a jaggy. */
    var worst = -1e9, at = (n >> 1), R = RUN_R;
    for (i = 1; i < n - 1; i++) {
      var sum = 0, cnt = 0;
      for (k = -R; k <= R; k++) { var j = i + k; if (j < 0 || j >= n) continue; sum += ex[j]; cnt++; }
      var v = sum / cnt;
      if (ex[i] > GROSS) v = ex[i];
      if (v > worst) { worst = v; at = i; }
    }
    return { err: worst, at: at };
  }

  /* Newton step: slide each sample along the curve to where it is actually
     closest, which lets the next least-squares pass do far better */
  function reparam(pts, u, bez) {
    var out = [], i;
    for (i = 0; i < pts.length; i++) {
      var t = u[i], p = bezAt(bez, t), d1 = bezD(bez, t), d2 = bezDD(bez, t),
          diff = sub(p, pts[i]),
          num = dot(diff, d1), den = dot(d1, d1) + dot(diff, d2),
          nt = (Math.abs(den) < 1e-12) ? t : t - num / den;
      if (!isFinite(nt)) nt = t;
      if (nt < 0) nt = 0; if (nt > 1) nt = 1;
      out.push(nt);
    }
    /* parameters must stay in order or the next fit is nonsense */
    for (i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) return u;
    return out;
  }

  /* One cubic through the whole stretch, refined by Newton until it is inside
     the allowance. Null means no single curve will do it. */
  function fitTry(pts, tols, t1, t2) {
    var u = chordParam(pts), bez = fitOne(pts, u, t1, t2), m = maxError(pts, u, bez, tols), i;
    if (m.err <= 0) return bez;
    for (i = 0; i < 12; i++) {
      var u2 = reparam(pts, u, bez);
      if (u2 === u) break;
      u = u2; bez = fitOne(pts, u, t1, t2); m = maxError(pts, u, bez, tols);
      if (m.err <= 0) return bez;
    }
    return null;
  }

  /* off is where this stretch starts in the run it was cut from, so every
     curve remembers which points it came from and the tidy-up pass below can
     put two of them back together. */
  function fitRun(pts, tols, t1, t2, depth, out, off) {
    var n = pts.length;
    off = off || 0;
    if (n < 2) return;
    if (n === 2) {
      var d3 = dist(pts[0], pts[1]) / 3;
      out.push({ bez: [pts[0], add(pts[0], mul(t1, d3)), add(pts[1], mul(t2, d3)), pts[1]],
                 a: off, b: off + 1 });
      return;
    }
    if (depth < 24) {
      var got = fitTry(pts, tols, t1, t2);
      if (got) { out.push({ bez: got, a: off, b: off + n - 1 }); return; }
    }
    var u = chordParam(pts), bez = fitOne(pts, u, t1, t2), m = maxError(pts, u, bez, tols);
    if (depth >= 24) { out.push({ bez: bez, a: off, b: off + n - 1 }); return; }
    var at = m.at;
    if (at < 1) at = 1; if (at > n - 2) at = n - 2;
    var cen = norm(sub(pts[at - 1], pts[at + 1]));
    if (len(cen) === 0) cen = norm(sub(pts[at - 1], pts[at]));
    fitRun(pts.slice(0, at + 1), tols.slice(0, at + 1), t1, cen, depth + 1, out, off);
    fitRun(pts.slice(at), tols.slice(at), mul(cen, -1), t2, depth + 1, out, off + at);
  }

  /* Splitting always cuts at the worst point, which is the right place to cut
     but not always the fewest cuts. So afterwards keep asking whether two
     neighbouring curves would go back together as one and still hold the line.
     Fewer nodes, same accuracy — the outline a person would have drawn. */
  function mergeSegs(run, rt, segs) {
    var changed = true, guard = 0;
    while (changed && guard++ < 40) {
      changed = false;
      for (var i = 0; i + 1 < segs.length; i++) {
        var A = segs[i], B = segs[i + 1],
            pts = run.slice(A.a, B.b + 1), tol = rt.slice(A.a, B.b + 1);
        if (pts.length < 3) continue;
        var t1 = norm(sub(A.bez[1], A.bez[0])), t2 = norm(sub(B.bez[2], B.bez[3]));
        if (!len(t1) || !len(t2)) continue;
        var got = fitTry(pts, tol, t1, t2);
        if (!got) continue;
        segs.splice(i, 2, { bez: got, a: A.a, b: B.b });
        changed = true;
        i--;
      }
    }
    return segs;
  }

  /* ------------------------------------------------------------ assemble -- */

  /* tangent looking a few points along, so a single jaggy cannot tilt it */
  function tangentFwd(pts, i, n, closed) {
    var span = 3, j, acc = [0, 0], k;
    for (k = 1; k <= span; k++) {
      j = i + k;
      if (j >= n) { if (!closed) { j = n - 1; } else j = j % n; }
      acc = add(acc, norm(sub(pts[j], pts[i])));
    }
    return norm(acc);
  }
  function tangentBack(pts, i, n, closed) {
    var span = 3, j, acc = [0, 0], k;
    for (k = 1; k <= span; k++) {
      j = i - k;
      if (j < 0) { if (!closed) { j = 0; } else j = (j + n * 2) % n; }
      acc = add(acc, norm(sub(pts[j], pts[i])));
    }
    return norm(acc);
  }

  function num(v) {
    var s = (Math.round(v * 1000) / 1000).toString();
    return s === "-0" ? "0" : s;
  }

  function loopToPath(pts, tols, angLimit) {
    var n = pts.length, i;
    if (n < 3) return "";
    var mark = findCorners(pts, angLimit), corners = [];
    for (i = 0; i < n; i++) if (mark[i]) corners.push(i);
    if (corners.length && n >= 24) {
      var src = pts;
      pts = pts.slice();
      var nc = corners.length;
      for (i = 0; i < nc; i++) {
        var cc = corners[i],
            pv = corners[(i - 1 + nc) % nc], nx = corners[(i + 1) % nc],
            back = nc === 1 ? n : (cc - pv + n) % n,
            gap  = nc === 1 ? n : (nx - cc + n) % n,
            fixed = sharpenCorner(src, cc, n, back, gap); /* read the untouched loop */
        if (fixed) pts[cc] = fixed;
      }
    }

    var segs = [];
    /* fit one stretch of outline, then tidy it up before moving on */
    function doRun(run, rt, t1, t2) {
      if (run.length < 2) return;
      var s2 = [];
      fitRun(run, rt, t1, t2, 0, s2, 0);
      mergeSegs(run, rt, s2);
      for (var q = 0; q < s2.length; q++) segs.push(s2[q].bez);
    }

    if (corners.length < 1) {
      /* no corners at all — one closed run, split in two so the fit has ends */
      var half = Math.floor(n / 2), a = [], b = [], atol = [], btol = [];
      for (i = 0; i <= half; i++) { a.push(pts[i]); atol.push(tols[i]); }
      for (i = half; i <= n; i++) { b.push(pts[i % n]); btol.push(tols[i % n]); }
      doRun(a, atol, tangentFwd(pts, 0, n, true), tangentBack(pts, half, n, true));
      doRun(b, btol, tangentFwd(pts, half, n, true), tangentBack(pts, 0, n, true));
    } else {
      for (i = 0; i < corners.length; i++) {
        var s = corners[i], e = corners[(i + 1) % corners.length],
            run = [pts[s]], rt = [tols[s]], j = s;
        /* do-while, so a lone corner still yields the whole loop as one run */
        do { j = (j + 1) % n; run.push(pts[j]); rt.push(tols[j]); } while (j !== e);
        doRun(run, rt, tangentFwd(pts, s, n, true), tangentBack(pts, e, n, true));
      }
    }
    if (!segs.length) return "";

    var d = "M" + num(segs[0][0][0]) + " " + num(segs[0][0][1]);
    for (i = 0; i < segs.length; i++) {
      var b2 = segs[i], p0 = b2[0], c1 = b2[1], c2 = b2[2], p3 = b2[3],
          straight = offLine(p0, p3, c1) < 0.02 && offLine(p0, p3, c2) < 0.02;
      if (straight) d += "L" + num(p3[0]) + " " + num(p3[1]);
      else d += "C" + num(c1[0]) + " " + num(c1[1]) + " " + num(c2[0]) + " " + num(c2[1]) +
                " " + num(p3[0]) + " " + num(p3[1]);
    }
    return d + "Z";
  }

  function offLine(a, b, p) {
    var d = sub(b, a), L = len(d);
    if (L < 1e-9) return dist(a, p);
    return Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / L;
  }

  /* ----------------------------------------------------------------- API -- */

  /* opts:
       threshold  1..254   what counts as shape (same slider as before)
       invert     bool     light shape on a dark background
       smooth     0..8     0 follows every detail, 8 is glass smooth
       turdsize   px       ignore specks smaller than this many pixels
       subpixel   bool     snap to the real edge using the greyscale (default on)
  */
  var BEND_REF = 0.10,     /* sag, in pixels, that counts as fully bent      */
      HARD_FLOOR = 0.38,   /* loosest a 1-bit bend is ever known to          */
      HARD_SIG = 0.4,      /* extra smoothing span on hard-edged stretches   */
      GROSS = 0.45,        /* a miss this big is a real feature, not a jaggy */
      RUN_R = 2;           /* how long a stretch has to be out to count      */

  /* every one of these was chosen by measuring against shapes whose true
     geometry is known exactly — see tracebench.cjs and tunefit.cjs */
  function setTuning(opts, sm) {
    BEND_REF   = opts._bendRef   != null ? opts._bendRef   : 0.10;
    HARD_FLOOR = opts._hardFloor != null ? opts._hardFloor : 0.38;
    HARD_SIG   = opts._hardSig   != null ? opts._hardSig   : 0.4;
    GROSS      = opts._gross     != null ? opts._gross     : 0.45;
    RUN_R      = opts._runR      != null ? opts._runR      : 2;
  }

  function trace(img, opts) {
    opts = opts || {};
    var thr = opts.threshold == null ? 128 : opts.threshold,
        inv = !!opts.invert,
        sm = opts.smooth == null ? 3 : opts.smooth,
        turd = opts.turdsize == null ? 2 : opts.turdsize,
        subpix = opts.subpixel !== false,
        w = img.width, h = img.height;
    setTuning(opts, sm);

    var mask = buildMask(img, thr, inv),
        loops = contours(mask, turd);
    if (!loops.length) return { d: "", count: 0, width: w, height: h };

    /* smooth 0..8 -> how sharp a turn has to be before it counts as a corner,
       how hard the zig-zag of the pixel grid is pressed out, and how tightly
       the curve has to hug the points */
    var angLimit = (26 + sm * 6) * Math.PI / 180,     /* 26deg .. 74deg */
        sigma = 0.75 + sm * 0.22,                     /* pixels          */
        tol = 0.05 + sm * 0.05;                       /* pixels          */

    var gray = buildGray(img, inv), g = gray.g, i, k, edgePts = 0, softAll = 0;
    for (i = 0; i < loops.length; i++) edgePts += loops[i].pts.length;

    var d = "", count = 0;
    for (i = 0; i < loops.length; i++) {
      var raw = loops[i].pts, nn = raw.length,
          soft = softness(raw, gray.md, w, h),
          pts = smoothLoop(raw, sigma, soft, HARD_SIG);
      if (subpix) pts = snapLoop(pts, g, w, h);
      var bend = bendAmount(pts), tols = new Float64Array(nn), sfLoop = 0;
      for (k = 0; k < nn; k++) {
        /* A picture with no anti-aliasing cannot say where its edge runs to
           better than about a third of a pixel — the staircase is all there is.
           So on a hard-edged bend the curve is never chased tighter than that,
           whatever the slider says; chasing the staircase only buries the shape
           in nodes without getting any closer to the truth. A hard STRAIGHT run
           is known precisely, so it gets no such licence, and a soft (anti-
           aliased) edge carries real sub-pixel detail and keeps the tight fit. */
        var bendy = bend[k] / BEND_REF; if (bendy > 1) bendy = 1;
        var floor = HARD_FLOOR * (1 - soft[k]) * bendy;
        tols[k] = tol > floor ? tol : floor;
        sfLoop += soft[k];
      }
      softAll += sfLoop;
      var seg = loopToPath(pts, tols, angLimit);
      if (seg) { d += seg; count++; }
    }
    return { d: d, count: count, width: w, height: h,
             antialiased: edgePts ? (softAll / edgePts) > 0.35 : true };
  }

  /* The outline as plain points, before any curve fitting — used by the test
     bench to measure how well the edge itself was found, separately from how
     well the curves were fitted to it. */
  function outlinePoints(img, opts) {
    opts = opts || {};
    var thr = opts.threshold == null ? 128 : opts.threshold,
        inv = !!opts.invert,
        sm = opts.smooth == null ? 3 : opts.smooth,
        turd = opts.turdsize == null ? 2 : opts.turdsize,
        subpix = opts.subpixel !== false,
        w = img.width, h = img.height,
        sigma = 0.75 + sm * 0.22,
        _t = setTuning(opts, sm),
        gray = buildGray(img, inv),
        loops = contours(buildMask(img, thr, inv), turd), out = [], i;
    for (i = 0; i < loops.length; i++) {
      var raw = loops[i].pts,
          pts = smoothLoop(raw, sigma, softness(raw, gray.md, w, h), HARD_SIG);
      if (subpix) pts = snapLoop(pts, gray.g, w, h);
      out.push(pts);
    }
    return out;
  }

  return { trace: trace, outlinePoints: outlinePoints, version: "1.0" };
})();
